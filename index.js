const express = require('express');
const { Client } = require('pg');
const bodyParser = require('body-parser');

const app = express();

const port = 3500;
const DB_client = new Client({
    host: 'localhost',
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
        var result = await DB_client.query(query);

        if (result) {
            res.send({ services: result.rows });
        } else {
            res.sendStatus(404);
        }
    })();
});

function findBookedEvents(service, startDate) {
    (async function() {
        var query = 'select * from calendar_event where secondary_id = ' + service.id + ' and extract(epoch from date) between ' + (startDate/1000) + ' and ' + ((startDate/1000) + (60*60*24*7));
        var result = await DB_client.query(query);
        return (result) ? result.rows : null;
    })();
}

function findInUseEvents(service, startDate) {
    (async function() {
        var query = 'select * from calendar_event where resource_id = ' + service.resource_id + ' and extract(epoch from date) between ' + (startDate/1000) + ' and ' + ((startDate/1000) + (60*60*24*7));
        var result = await DB_client.query(query);
        return (result) ? result.rows : null;
    })();
}

function getSecondaryServiceInfo(service_id) {
    (async function() {
        var query = 'select * from secondary_service where id = ' + service_id;
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);
        return result.rows[0];
    })();
}

function runQuery(query, fn) {
    console.log('QUERY: ' + query);
    DB_client.query(query, (err, result) => {
        if (err) {
            console.log(err);
            fn(null);
        } else {
            fn(result);
        }
    });
}

app.post('/api/getCalendarInfo', (req, res) => {
    var query = 'select * from secondary_service where id = ' + req.body.service_id;
    runQuery(query, (result) => {
        var service = result.rows[0];    
        if (service.type == 'class') {

        } else {
            query = 'select * from calendar_event where secondary_id = ' + service.id + ' and extract(epoch from date) between ' + (req.body.start/1000) + ' and ' + ((req.body.start/1000) + (60*60*24*7));
            runQuery(query, (eventResult) => {
                query = 'select * from calendar_event where resource_id = ' + service.resource_id + ' and extract(epoch from date) between ' + (req.body.start/1000) + ' and ' + ((req.body.start/1000) + (60*60*24*7));
                runQuery(query, (inUseResult) => {
                    res.send({
                        events: eventResult.rows,
                        inUse: inUseResult.rows
                    });
                });
            });
        }
    });
});

// End - API

app.listen(port, () => {
    console.log('Listening on port ' + port + '...');
});