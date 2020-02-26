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

// End - API

app.listen(port, () => {
    console.log('Listening on port ' + port + '...');
});