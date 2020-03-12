const express = require('express');
const { Client } = require('pg');
const bodyParser = require('body-parser');

const app = express();

const port = 3500;
const DB_client = new Client({
    host: '99.242.212.59',
    port: 5432,
    database: 'CosgroveHockeyAcademy',
    user: 'postgres',
    password: 'mplkO0'
});
DB_client.connect();
app.use(bodyParser.urlencoded({ extended: false }))
app.use('*', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

// Start - API
app.get('/api/serverURL', (req, res) => {
    res.send({ server: 'http://localhost:3500' });
});

app.get('/api/getServices', (req, res) => {
    (async function() {
        var query = 'select * from primary_service order by id asc;';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);

        if (result) {
            res.send({ services: result.rows });
        } else {
            res.sendStatus(404);
        }
    })();
});

app.post('/api/getSecondaryServices', (req, res) => {
    (async function() {
        var query = 'select * from secondary_service where primary_service_id = ' + req.body.service_id + ' order by id asc;';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);

        if (result) {
            res.send({ services: result.rows });
        } else {
            res.sendStatus(404);
        }
    })();
});

app.post('/api/getCalendarInfo', (req, res) => {
    (async function() {
        async function findFirst(currentDate) {
            currentDate.setHours(0,0,0,0);
            const start = currentDate.getTime();
            currentDate.setDate(currentDate.getDate() + (6-currentDate.getDay()));
            currentDate.setHours(23,59,0,0);
            const end = currentDate.getTime();

            var query = 'select c.*, extract(epoch from date) as epoch_date, concat(i.first_name, \' \', i.surname) as instructor_name from calendar_event c, instructor i where secondary_id = ' + req.body.id + ' and i.id = instructor and (extract(epoch from date)*1000) between ' + start + ' and ' + end;
            console.log('QUERY: ' + query);
            const result = await DB_client.query(query);
            currentDate.setHours(currentDate.getHours() + 1);
            return (result.rowCount > 0) ? {
                start: start,
                events: result.rows
            } : findFirst(currentDate);
        }

        // Need to compile service info
        var query = 'select s.*, concat(i.first_name, \' \', i.surname) as instructor_name, p.name as primary_name from secondary_service s, instructor i, primary_service p where s.id = ' + req.body.id + ' and i.id = s.default_instructor and p.id = s.primary_service_id';
        console.log('QUERY: ' + query);
        var serviceResult = await DB_client.query(query);

        // If this is a class, determine the first instance
        var startDate = new Date(Number.parseInt(req.body.date));
        startDate.setDate(startDate.getDate() - startDate.getDay());
        startDate.setHours(0,0,0,0);

        if (serviceResult.rows[0].type == 'class') {
            var first = await findFirst(startDate);
            res.send({
                service_info: serviceResult.rows[0],
                events: first.events,
                startDate: first.start
            });
        } else {
            // Check for events scheduled during the week
            query = 'select c.*, extract(epoch from date) as epoch_date, concat(i.first_name, \' \', i.surname) as instructor_name from calendar_event c, instructor i where secondary_id = ' + req.body.id + ' and i.id = instructor and (extract(epoch from date)*1000) between ' + startDate.getTime() + ' and ' + (startDate.getTime() + (1000*60*60*24*7));
            console.log('QUERY: ' + query);
            var eventResult = await DB_client.query(query);

            res.send({
                service_info: serviceResult.rows[0],
                events: eventResult.rows,
                startDate: startDate.getTime()
            });
        }
    })();
});

// End - API

app.listen(port, () => {
    console.log('Listening on port ' + port + '...');
});