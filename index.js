const express = require('express');
const { Client } = require('pg');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const hash = require('crypto-js');
const nodemailer = require('nodemailer');
const https = require('https');
const fs = require('fs');

// Set your secret key. Remember to switch to your live secret key in production!
// See your keys here: https://dashboard.stripe.com/account/apikeys
const stripe = require('stripe')('sk_test_I86H6VkUjtbDN5B7304wBpyw00nChfGgPw');

const app = express();

const port = 5460;
const secret_key = '65F1FAD3B9E2C35E1C297179A389AFA32A4B68907209ECC5E6F94479489F4258';
const DB_client = new Client({
    host: '99.242.212.59',
    port: 5432,
    database: 'CHA',
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
function time(date) {
    var hours = date.getUTCHours();
    var mins = date.getUTCMinutes();
    var endStamp = (hours >= 12) ? ' PM' : ' AM';

    var timeString = (hours > 12) ? (hours -= 12) : hours;
    timeString += ':' + ((mins === 0) ? '00' : mins) + endStamp;

    return timeString;
}

function dateString(date) {
    // DD/MM/YYYY
    var day = date.getUTCDate();
    var month = date.getUTCMonth();
    var year = date.getUTCFullYear();

    if (day < 10) { day = '0' + day; }
    if (month < 10) { month = '0' + month; }
    
    return day + '/' + month + '/' + year;
}

function toUTCTime(epoch) {
    return epoch - (1000*60*new Date().getTimezoneOffset());
}

app.get('/api/serverURL', (req, res) => {
    res.send({ server: 'http://localhost:3500' });
});

app.post('/api/deleteBooking', (req, res) => {
    (async function() {
        // If the event occupied by this booking is open and has only 1 spot taken, delete the event as well.
        //      Otherwise, decrement the open_spots of the event.
        var query = 'select e.id, e.open_spots, e.total_spots, e.service_id, s.id as sale_id, ss.type from event e, sale s, service ss' +
                    ' where s.id = ' + req.body.id + ' and e.id = s.event_id and ss.id = e.service_id';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);

        if (result.rows[0].type == 'open' && result.rows[0].open_spots == (result.rows[0].total_spots - 1)) {
            // Remove the event
            query = 'delete from event where id = ' + result.rows[0].id;
            console.log('QUERY: ' + query);
            var deleteResult = await DB_client.query(query);
        } else {
            // Decrement the open spots
            query = 'update event set open_spots = (open_spots - 1) where id = ' + result.rows[0].id;
            console.log('QUERY: ' + query);
            var decrementResult = await DB_client.query(query);
        }

        // Delete the sale
        query = 'delete from sale where id = ' + req.body.id;
        console.log('QUERY: ' + query);
        result = await DB_client.query(query);

        res.send({ error: null });
    })();
});

app.post('/api/updatePaidBooking', (req, res) => {
    (async function() {
        var query = 'update sale set amount_due = 0 where id = ' + req.body.id;
        var result = await DB_client.query(query);
        res.send({ error: null });
    })();
});

app.post('/api/searchBookings', (req, res) => {
    (async function() {
        var filledFields = JSON.parse(req.body.filledFields);

        var query = 'select s.*, ss.id_chain, ss.duration, ss.name as service_name, extract(epoch from date) as epoch_date from sale s, service ss where ss.id = s.service_id';
        for (var i in filledFields) {
            if (filledFields[i] != null) {
                // This is appalling, TODO come up with nicer looking solution
                if (i == 0) { query += ' and first_name = \'' + filledFields[i] + '\''; }
                if (i == 1) { query += ' and last_name = \'' + filledFields[i] + '\''; }
                if (i == 2) { query += ' and email = \'' + filledFields[i] + '\''; }
                if (i == 3) { query += ' and phone = \'' + filledFields[i] + '\''; }
                if (i == 4) { query += ' and child_first_name = \'' + filledFields[i] + '\''; }
                if (i == 5) { query += ' and child_last_name = \'' + filledFields[i] + '\''; }
                if (i == 6) { query += ' and s.service_id = ' + filledFields[i]; }
                if (i == 7) { query += ' and extract(day from date) = ' + filledFields[i]; }
                if (i == 8) { query += ' and extract(month from date) = ' + filledFields[i]; }
                if (i == 9) { query += ' and extract(hours from date) = ' + filledFields[i]; }
                if (i == 10) { query += ' and extract(minutes from date) = ' + filledFields[i]; }
            }
        }
        query += ' order by id asc;';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);
        var bookings = result.rows;
        for (var i in bookings) {
            bookings[i].fullServiceName = await getFullServiceName({ name: bookings[i].service_name, id_chain: bookings[i].id_chain });
        }

        if (result.rowCount > 0) {
            res.send({ bookings: bookings });
        } else {
            res.send({ error: 'No results found.' });
        }
    })();
});

app.get('/api/searchTodayBookings', (req, res) => {
    (async function() {
        var currentDate = new Date();
        var query = 'select s.*, ss.id_chain, ss.duration, ss.name as service_name, extract(epoch from date) as epoch_date from sale s, service ss where ss.id = s.service_id and extract(day from date) = ' + currentDate.getDate() +
                    ' and extract(month from date) = ' + (currentDate.getUTCMonth() + 1) + ' and extract(year from date) = ' + currentDate.getFullYear();
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);
        var bookings = result.rows;
        for (var i in bookings) {
            bookings[i].fullServiceName = await getFullServiceName({ name: bookings[i].service_name, id_chain: bookings[i].id_chain });
        }

        if (result.rowCount > 0) {
            res.send({ bookings: bookings });
        } else {
            res.send({ error: 'No results found.' });
        }
    })();
});

app.post('/api/getAllSales', (req, res) => {
    (async function() {
        var payload = getPayload(req.body.token);
        if (payload.admin) {
            var query = 'select sale.id, initcap(concat(first_name,\' \',last_name)) as name, email, initcap(concat(child_first_name,\' \',child_last_name)) as child_name, s.id_chain, s.name as service_name, extract(epoch from date)*1000 as date, amount_due, round(sale.price::numeric*0.884956,2) as base_price, round(sale.price::numeric*0.115044,2) as tax, round(sale.price::numeric,2) as total from sale, service s where s.id = service_id order by date desc';
            console.log('QUERY: ' + query);
            var result = await DB_client.query(query);

            // Add service name to sales
            for (var i in result.rows) {
                var name = await getFullServiceName({
                    id_chain: result.rows[i].id_chain,
                    name: result.rows[i].service_name
                });
                result.rows[i].fullServiceName = name;
            }

            res.send({ sales: result.rows });
        } else {
            res.sendStatus(403);
        }
    })();
});

app.get('/api/getAllServices', (req, res) => {
    (async function() {
        var query = 'select * from service order by id asc;';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);
        if (result.rowCount > 0) {
            res.send({ services: result.rows });
        } else {
            res.send({ error: 'Internal server error' });
        }
    })();
});

app.get('/api/getMemberships', (req, res) => {
    (async function() {
        var query = 'select * from membership';
        var result = await DB_client.query(query);
        res.send({ memberships: result.rows });
    })();
});

app.post('/api/getServices', (req, res) => {
    (async function() {
        console.log(req.body.level);
        if (req.body.level == 1) {
            // Get parent services
            var query = 'select * from service where id_chain is null order by id asc';
            console.log('QUERY: ' + query);
            var result = await DB_client.query(query);
            res.send({ services: result.rows });
        } else {
            if (req.body.previous) {
                // Get a list of all parent services of the given service
                var query = 'select * from service where ' + req.body.previous + ' = any(id_chain) and array_length(id_chain,1) = ' + (req.body.level-1) + ' order by id asc';
                console.log('QUERY: ' + query);
                var result = await DB_client.query(query);
                if (result.rowCount > 0) {
                    res.send({ services: result.rows });
                } else {
                    // This is the last service in the chain
                    res.send({ services: [] });
                }
            } else {
                // Get a list of all child services
                var query = 'select * from service where ' + req.body.id + ' = any(id_chain) and array_length(id_chain,1) = ' + (req.body.level-1) + ' order by id asc';
                console.log('QUERY: ' + query);
                var result = await DB_client.query(query);
                if (result.rowCount > 0) {
                    res.send({ services: result.rows });
                } else {
                    // This is the last service in the chain
                    res.send({ services: [] });
                }
            }
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

            var query = 'select e.*, extract(epoch from date) as epoch_date, concat(i.first_name, \' \', i.last_name) as instructor_name, s.duration as serviceDuration, s.price, s.type from event e, instructor i, service s where service_id = ' + req.body.id + ' and s.id = ' + req.body.id + ' and i.id = s.instructor and (extract(epoch from date)*1000) between ' + start + ' and ' + end;
            console.log('QUERY: ' + query);
            const result = await DB_client.query(query);
            currentDate.setHours(currentDate.getHours() + 1);
            var actualDate = new Date();
            actualDate.setDate(actualDate.getDate() + 90);
            if (currentDate.getTime() > actualDate.getTime()) {
                // No events for 3 months
                return null;
            } else {
                return (result.rowCount > 0) ? {
                    start: start,
                    events: result.rows
                } : findFirst(currentDate);
            }
        }

        // Need to compile service info
        var query = 'select s.*, concat(i.first_name, \' \', i.last_name) as instructor_name from service s, instructor i where s.id = ' + req.body.id + ' and i.id = s.instructor';
        console.log('QUERY: ' + query);
        var serviceResult = await DB_client.query(query);
        var baseService = serviceResult.rows[0];
        baseService.fullServiceName = await getFullServiceName(baseService);
        console.log(baseService.fullServiceName);

        // If this is a class, determine the first instance
        var startDate = new Date(req.body.date*1000);
        startDate.setDate(startDate.getDate() - startDate.getDay());
        startDate.setHours(0,0,0,0);

        if (baseService.type == 'class') {
            var first = await findFirst(startDate);
            if (first != null) {
                res.send({
                    service_info: baseService,
                    events: first.events,
                    startDate: first.start
                });
            } else {
                res.send({ error: 'There are no scheduled events for the next 3 months.' });
            }
        } else {
            // Check for events scheduled during the week
            query = 'select e.*, extract(epoch from date) as epoch_date from event e where service_id = ' + baseService.id + ' and (extract(epoch from date)*1000) between ' + startDate.getTime() + ' and ' + (startDate.getTime() + (1000*60*60*24*7));
            console.log('QUERY: ' + query);
            var eventResult = await DB_client.query(query);

            // Check for large events, unless this service is sense arena
            var largeEventResult = null;
            if (baseService.resource_id != 4) {
                query = 'select e.*, extract(epoch from date) as epoch_date, s.duration as serviceDuration, s.resource_id from event e, service s where s.id = e.service_id and s.resource_id = 8 and (extract(epoch from date)*1000) between ' + startDate.getTime() + ' and ' + (startDate.getTime() + (1000*60*60*24*7));
                console.log('QUERY: ' + query);
                largeEventResult = await DB_client.query(query);
            }

            // Add the service info to each event
            for (var i in eventResult.rows) {
                eventResult.rows[i].service = baseService;
            }

            res.send({
                service_info: baseService,
                events: eventResult.rows,
                startDate: startDate.getTime(),
                largeEvents: (largeEventResult) ? largeEventResult.rows : null
            });
        }
    })();
});

app.post('/api/getEventManagerEvents', (req, res) => {
    (async function() {
        var query = 'select e.*, extract(epoch from date) as epoch_date, s.type, s.duration as serviceDuration, s.price, concat(i.first_name, \' \', i.last_name) as instructor_name, s.type from event e, service s, instructor i where s.id = e.service_id and s.type = \'class\' and i.id = s.instructor and extract(epoch from date)*1000 between ' + req.body.date + ' and ' + (parseInt(req.body.date) + (1000*60*60*24*7)) + ' order by date asc';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);

        // Find the service ancestor for colour coding
        for (var i in result.rows) {
            query = 'select name, id_chain from service where id = ' + result.rows[i].service_id;
            var serviceResult = await DB_client.query(query);

            query = 'select colour from service where id = ' + serviceResult.rows[0].id_chain[0];
            serviceResult = await DB_client.query(query);
            result.rows[i].colour = serviceResult.rows[0].colour;
        }

        res.send({
            events: result.rows
        });
    })();
});

app.post('/api/getEvent', (req, res) => {
    (async function() {
        var query = 'select e.*, s.duration, s.type, s.price, extract(epoch from date) as epoch_date from event e, service s where e.id = ' + req.body.id + ' and s.id = e.service_id';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);

        if (result.rowCount > 0) {
            res.send({
                event: result.rows[0]
            });
        } else {
            res.send({ error: 'No event found in DB' });
        }
    })();
});

app.post('/api/addEvent', (req, res) => {
    (async function() {
        // Check for existing events during the time period
        var query = 'select * from event where service_id = ' + req.body.service + ' and extract(epoch from date) between ' + req.body.date + ' and ' + (parseInt(req.body.date) + (60*req.body.duration));
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);
        if (result.rowCount > 0) {
            // Event exists in this time slot
            res.send({ error: 'An event of the same service exists in the timeslot given.' });
        } else {
            var days = req.body.days != 'null' ? JSON.parse(req.body.days) : null;
            console.log((days != null) + ',' + (req.body.durationInterval != 'Hours'));
            if (days != null || req.body.durationInterval != 'Hours') {
                // This is a recurring event
                // Add a recurring event to the DB and get the ID first
                query = 'insert into recurrence(service) values (\'' + req.body.service + '\')';
                console.log('QUERY: ' + query);
                result = await DB_client.query(query);

                // Get the recurrence ID
                query = 'select id from recurrence where id=(select max(id) from recurrence)';
                console.log('QUERY: ' + query);
                result = await DB_client.query(query);
                var recurrence_id = result.rows[0].id;

                // Get default duration if client sent null
                var duration = req.body.duration;
                if (req.body.duration == 'null') {
                    query = 'select duration from service where id = ' + req.body.service;
                    console.log('QUERY: ' + query);
                    result = await DB_client.query(query);
                    duration = result.rows[0].duration;
                }


                var date = new Date(req.body.date*1000);
                if (days != null && req.body.days.length > 0) {
                    // Weekly recurring event
                    console.log('WEEKLY RECURRING EVENT');
                    console.log(days);
                    for (var i in days) {
                        date = new Date(req.body.date*1000);
                        date.setDate(date.getDate() - date.getDay());
                        date.setDate(date.getDate() + days[i]);
                        for (var j=0; j<26; j++) {
                            //console.log(date);
                            query = 'insert into event(name, service_id, date, recurrence_id, open_spots, total_spots, duration) values ' +
                                    '(\'' + req.body.name + '\', ' + req.body.service + ',to_timestamp(' + (date.getTime()/1000) + ') at time zone \'UTC\', ' + recurrence_id + ',' + req.body.spots + ',' + req.body.spots + ', ' + duration + ')';
                            //console.log('QUERY: ' + query);
                            result = await DB_client.query(query);
                            date.setDate(date.getDate() + 7);
                        }
                    }
                } else {
                    if (req.body.durationInterval == 'Days') {
                        // Multi-day event
                        console.log('MULTI DAY EVENT');
                        for (var i=0; i<req.body.duration; i++) {
                            query = 'insert into event(name, service_id, date, recurrence_id, open_spots, total_spots, duration) values ' +
                                    '(\'' + req.body.name + '\', ' + req.body.service + ',to_timestamp(' + (date.getTime()/1000) + ') at time zone \'UTC\', ' + recurrence_id + ',' + req.body.spots + ',' + req.body.spots + ', ' + duration + ')';
                            console.log('QUERY: ' + query);
                            result = await DB_client.query(query);
                            date.setDate(date.getDate() + 1);
                        }
                    } else {
                        // Multi-week event
                        console.log('MULTI WEEK EVENT');
                        for (var i=0; i<req.body.duration; i++) {
                            for (var j=0; j<5; j++) {
                                query = 'insert into event(name, service_id, date, recurrence_id, open_spots, total_spots, duration) values ' +
                                        '(\'' + req.body.name + '\', ' + req.body.service + ',to_timestamp(' + (date.getTime()/1000) + ') at time zone \'UTC\', ' + recurrence_id + ',' + req.body.spots + ',' + req.body.spots + ', ' + duration + ')';
                                console.log('QUERY: ' + query);
                                result = await DB_client.query(query);
                                date.setDate(date.getDate() + 1);
                                if (date.getDay() == 6) {
                                    date.setDate(date.getDate() + 2);
                                }
                            }
                        }
                    }
                }
                res.send({ error: null });
            } else {
                console.log('SINGLE EVENT');
                // This is a single event, add it
                query = 'insert into event(name, service_id, date, recurrence_id, open_spots, total_spots, duration) values ' +
                        '(\'' + req.body.name + '\', ' + req.body.service + ',to_timestamp(' + req.body.date + ') at time zone \'UTC\', null, ' + req.body.spots + ',' + req.body.spots + ', ' + duration + ')';
                console.log('QUERY: ' + query);
                result = await DB_client.query(query);
                res.send({ error: null });
            }
        }
    })();
});

app.post('/api/getScheduleEvents', (req, res) => {
    (async function() {
        var start = req.body.date/1000, end = (parseInt(req.body.date) + (1000*60*60*24*7))/1000;
        var query = 'select *, extract(epoch from date)*1000 as epoch_date from event where extract(epoch from date) between ' + start + ' and ' + end + ' order by date asc;';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);

        // Find the service ancestor for colour coding
        for (var i in result.rows) {
            query = 'select name, id_chain from service where id = ' + result.rows[i].service_id;
            var serviceResult = await DB_client.query(query);

            query = 'select colour from service where id = ' + serviceResult.rows[0].id_chain[0];
            serviceResult = await DB_client.query(query);
            result.rows[i].colour = serviceResult.rows[0].colour;
        }

        res.send({ events: result.rows });
    })();
});

async function getFullServiceName(service) {
    var name = '';
    if (service.id_chain != null) {
        if (service.id_chain.length > 0) {
            for (var i in service.id_chain) {
                var query = 'select name from service where id = ' + service.id_chain[i];
                console.log('QUERY: ' + query);
                var result = await DB_client.query(query);

                name += result.rows[0].name + ' - ';
            }
        }
    }
    return name + service.name;
}

app.post('/api/deleteEvents', (req, res) => {
    (async function() {
        var startEvent = JSON.parse(req.body.startEvent);
        console.log(req.body.singleEvent);
        if (req.body.singleEvent == 'true') {
            // Check if there is a booking on the given event
            if (startEvent.open_spots < startEvent.total_spots) {
                // Someone has this event booked
                res.send({ error: 'This event contains a booking.' });
            } else {
                // Delete the single event given
                var query = 'delete from event where id = ' + startEvent.id;
                console.log('QUERY: ' + query);
                var result = await DB_client.query(query);
                res.send({ error: null });
            }
        } else {
            // Check if there is a booking on any of the events in the recurrence
            var query = 'select id from event where recurrence_id = ' + startEvent.recurrence_id + ' and open_spots < total_spots';
            console.log('QUERY: ' + query);
            var result = await DB_client.query(query);
            if (result.rowCount > 0) {
                res.send({ error: ((result.rowCount > 1) ? result.rowCount + ' events' : 'One event') + ' in this recurrence contain' + ((result.rowCount > 1) ? '' : 's') + ' a booking.' });
            } else {
                // Delete all events belonging to the same recurrence as the event given
                var query = 'delete from event where recurrence_id = ' + startEvent.recurrence_id;
                console.log('QUERY: ' + query);
                var result = await DB_client.query(query);

                // Delete the recurrence entry
                query = 'delete from recurrence where id = ' + startEvent.recurrence_id;
                console.log('QUERY: ' + query);
                result = await DB_client.query(query);
                res.send({ error: null });
            }
        }
    })();
});

app.get('/api/getSelectData', (req, res) => {
    (async function() {
        // Get services
        var query = 'select * from service where type = \'class\' and id_chain is not null order by id asc';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);
        for (var i in result.rows) result.rows[i].fullServiceName = await getFullServiceName(result.rows[i]);

        // Get instructors
        query = 'select *, concat(first_name, \' \', last_name) as fullName from instructor';
        console.log('QUERY: ' + query);
        var instructorResult = await DB_client.query(query);
        
        res.send({
            services: result.rows,
            instructors: instructorResult.rows
        });
    })();
});

app.post('/api/getPayload', (req, res) => {
    if (req.body.token != null) {
        var payload = jwt.verify(req.body.token, secret_key);
        res.send({
            payload: payload
        });
    } else {
        res.send({ payload: null });
    }
});

app.post('/api/getUserBookings', (req, res) => {
    (async function() {
        var payload = getPayload(req.body.token);
        var date = new Date().getTime();
        query = 'select sa.*, extract(epoch from sa.date) as epoch_date, s.price, s.duration, s.name, s.id_chain from sale sa, service s where sa.user_id = ' + payload.id + ' and s.id = sa.service_id and extract(epoch from sa.date)*1000 between ' + req.body.date + ' and ' + date;
        if (req.body.date === '0') {
            // Future bookings
            query = 'select sa.*, extract(epoch from sa.date) as epoch_date, s.price, s.duration, s.name, s.id_chain from sale sa, service s where sa.user_id = ' + payload.id + ' and s.id = sa.service_id and extract(epoch from sa.date)*1000 > ' + date;
        } else if (req.body.date === '1') {
            // All bookings
            query = 'select sa.*, extract(epoch from sa.date) as epoch_date, s.price, s.duration, s.name, s.id_chain from sale sa, service s where sa.user_id = ' + payload.id + ' and s.id = sa.service_id';
        }
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);
        if (result.rowCount > 0) {
            for (var i in result.rows) {
                result.rows[i].fullServiceName = await getFullServiceName({ id_chain: result.rows[i].id_chain, name: result.rows[i].name });
            }
        }

        res.send({ bookings: result.rows });
    })();
});

function getPayload(token) {
    return jwt.verify(token, secret_key);
}

var genRandomString = function(seed){
    var rand = Math.random()*(seed^5) + 1;
    return hash.SHA256(rand).toString(hash.enc.Hex).toUpperCase();
};

app.post('/api/login', (req, res) => {
    (async function() {
        // Check that user exists
        var query = 'select * from users where email = \'' + req.body.email + '\'';
        console.log('QUERY: ' + query);
        var checkEmailResult = await DB_client.query(query);

        if (checkEmailResult.rowCount > 0) {
            // User exists, hash the given password
            var user = checkEmailResult.rows[0];
            var hashed = hash.SHA256(user.salt + req.body.pass).toString(hash.enc.Hex).toUpperCase();
            // Set this as their password now, and allow the login. Set changed to true
            //      so I know that they have updated the password.
            if (user.passchanged) {
                console.log('check password');
                if (hashed == user.password) {
                    // Passwords match, generate a token and send to client
                    res.send({ token: generateToken(user) });
                } else {
                    // Passwords don't match, send result to client
                    res.send({ error: 'Incorrect password, please try again.' });
                }
            } else {
                console.log('set password');
                query = 'update users set salt = \'' + user.salt + '\', password = \'' + hashed + '\', passChanged = true where email = \'' + req.body.email + '\'';
                var result = await DB_client.query(query);
                // Generate a token and send to client
                res.send({ token: generateToken(user) });
            }
        } else {
            // No user exists with that email
            res.send({ error: 'No user exists with that email. Please try another email.' });
        }
    })();
});

app.post('/api/employeeLogin', (req, res) => {
    (async function() {
        // Check that user exists
        var query = 'select * from employee where email = \'' + req.body.email + '\'';
        console.log('QUERY: ' + query);
        var checkEmailResult = await DB_client.query(query);

        if (checkEmailResult.rowCount > 0) {
            // User exists, hash the given password
            var user = checkEmailResult.rows[0];
            var hashed = hash.SHA256(user.salt + req.body.pass).toString(hash.enc.Hex).toUpperCase();
            if (hashed == user.password) {
                // Passwords match, generate a token and send to client
                res.send({ token: generateToken(user) });
            } else {
                // Passwords don't match, send result to client
                res.send({ error: 'Incorrect password, please try again.' });
            }
        } else {
            // No user exists with that email
            res.send({ error: 'No user exists with that email. Please try another email.' });
        }
    })();
});

app.post('/api/changePassword', (req, res) => {
    (async function() {
        var payload = getPayload(req.body.token);

        // Check given password against DB
        var query = 'select salt, password from users where id = ' + payload.id;
        var result = await DB_client.query(query);
        var oldPass = hash.SHA256(result.rows[0].salt + req.body.oldPass).toString(hash.enc.Hex).toUpperCase();

        if (oldPass == result.rows[0].password) {
            // Passwords match, change password
            // Generate a new salt for security
            var salt = hash.SHA256(hash.lib.WordArray.random(128 / 8)).toString(hash.enc.Hex).toUpperCase();
            var newPass = hash.SHA256(salt + req.body.newPass).toString(hash.enc.Hex).toUpperCase();

            query = 'update users set salt = \'' + salt + '\', password = \'' + newPass + '\' where id = ' + payload.id;
            result = await DB_client.query(query);
            res.send({ error: null });
        } else {
            res.send({ error: 'Current password was not correct, try again.' });
        }
    })();
});

app.post('/api/refreshToken', (req, res) => {
    (async function() {
        var payload = getPayload(req.body.token);
        var query = 'select * from users where id = ' + payload.id;
        var result = await DB_client.query(query);
        res.send({ token: generateToken(result.rows[0]) });
    })();
});

app.post('/api/changeInfo', (req, res) => {
    (async function() {
        var payload = getPayload(req.body.token);
        var query = 'update users set first_name = \'' + req.body.first_name + '\', last_name = \'' + req.body.last_name +
                    '\', email = \'' + req.body.email + '\', phone = \'' + req.body.phone + '\' where id = ' + payload.id;
        var result = await DB_client.query(query);
        res.send({ error: null });
    })();
});

app.post('/api/getEmployees', (req, res) => {
    (async function() {
        var payload = getPayload(req.body.token);
        if (payload.admin) {
            var query = 'select * from employee where id != 4 and admin = false';
            console.log('QUERY: ' + query);
            var result = await DB_client.query(query);

            query = 'select * from instructor';
            console.log('QUERY: ' + query);
            iResult = await DB_client.query(query);

            for (var i in result.rows) {
                result.rows[i].instructor = false;
                for (var j in iResult.rows) {
                    if (iResult.rows[j].employee_id == result.rows[i].id) {
                        result.rows[i].instructor = true;
                    }
                }
            }

            res.send({ employees: result.rows, instructors: iResult.rows });
        } else {
            res.sendStatus(403);
        }
    })();
});

app.post('/api/deleteEmployee', (req, res) => {
    (async function() {
        var payload = getPayload(req.body.token);
        if (payload.admin) {
            var query = 'delete from employee where id = ' + req.body.id;
            console.log('QUERY: ' + query);
            var result = await DB_client.query(query);
            res.send({ error: null });
        } else {
            res.sendStatus(403);
        }
    })();
});

app.post('/api/deleteInstructor', (req, res) => {
    (async function() {
        var payload = getPayload(req.body.token);
        if (payload.admin) {
            var query = 'delete from instructor where id = ' + req.body.id;
            console.log('QUERY: ' + query);
            var result = await DB_client.query(query);
            res.send({ error: null });
        } else {
            res.sendStatus(403);
        }
    })();
});

app.post('/api/addInstructor', (req, res) => {
    (async function() {
        var payload = getPayload(req.body.token);
        if (payload.admin) {
            var query = 'insert into instructor (first_name, last_name, employee_id) values (\'' + req.body.first_name +
                        '\',\'' + req.body.last_name + '\',' + req.body.id + ')';
            console.log('QUERY: ' + query);
            var result = await DB_client.query(query);
            res.send({ error: null });
        } else {
            res.sendStatus(403);
        }
    })();
});

app.post('/api/stageCart', (req, res) => {
    (async function() {
        var query = 'update staging set cart = \'' + req.body.cart + '\', active = false where id = 1';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);
        res.send({ error: null });
    })();
});

app.get('/api/updateStaging', (req, res) => {
    (async function() {
        var query = 'update staging set active = true where id = 1';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);

        query = 'select cart from staging where id = 1';
        console.log('QUERY: ' + query);
        result = await DB_client.query(query);

        res.send({ cart: result.rows[0].cart, error: null });
    })();
});

app.get('/api/checkStaging', (req, res) => {
    (async function() {
        var query = 'select active from staging where id = 1';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);
        res.send({ active: result.rows[0].active });
    })();
});

app.post('/api/unstageCart', (req, res) => {
    (async function() {
        var payload = getPayload(req.body.token);
        if (payload.id == 4) {
            var query = 'update staging set active = false where id = 1';
            console.log('QUERY: ' + query);
            var result = await DB_client.query(query);

            query = 'select total from staging where id = 1';
            console.log('QUERY: ' + query);
            result = await DB_client.query(query);
            res.send({ error: null, total: result.rows[0].total });
        } else {
            res.sendStatus(403);
        }
    })();
});

app.post('/api/newEmployee', (req, res) => {
    (async function() {
        var payload = getPayload(req.body.token);
        if (payload.admin) {
            var query = 'insert into employee (first_name, last_name, email, phone, pay, hourly, card_id) values (\'' +
                        req.body.first_name + '\',\'' + req.body.last_name + '\',\'' + req.body.email + '\',\'' +
                        req.body.phone + '\',' + req.body.pay + ',' + req.body.hourly + ',' + req.body.cardID + ')';
            console.log('QUERY: ' + query);
            var result = await DB_client.query(query);

            if (req.body.instructor) {
                query = 'select id from employee where email = \'' + req.body.email + '\'';
                console.log('QUERY: ' + query);
                result = await DB_client.query(query);

                query = 'insert into instructor (first_name, last_name, employee_id) values (\'' + req.body.first_name +
                        '\',\'' + req.body.last_name + '\',' + result.rows[0].id + ')';
                console.log('QUERY: ' + query);
                result = await DB_client.query(query);
            }
            res.send({ error: null });
        } else {
            res.sendStatus(403);
        }
    })();
});

function generateToken(user) {
    return jwt.sign({
        id: user.id,
        email: user.email,
        phone: user.phone,
        first_name: user.first_name,
        last_name: user.last_name,
        membership: user.membership,
        admin: user.admin
    }, secret_key);
}

app.post('/api/getClientSecret', (req, res) => {
    (async () => {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: (req.body.amount == 0 ? 1 : req.body.amount)*100,
            currency: 'cad',
            // Verify your integration in this guide by including this parameter
            metadata: {integration_check: 'accept_a_payment'},
        });
        res.send({ clientSecret: paymentIntent.client_secret });
    })();
});

app.post('/api/checkMemberDiscount', (req, res) => {
    (async function() {
        var payload = jwt.verify(req.body.token, secret_key);
        
        // Check if user has a membership
        if (payload.membership != null) {
            if (payload.membership > 0) {
                // Memberships have a free class booking per day.
                //      Check that they have not booked anything on this date before.
                var query = 'select * from sale where email = \'' + payload.email + '\' and extract(day from date) = ' +
                            new Date().getDate() + ' and extract(month from date) = ' + new Date().getMonth() +
                            ' and extract(year from date) = ' + new Date().getFullYear() + ' and free = true';
                console.log('QUERY: ' + query);
                var result = await DB_client.query(query);
                if (result.rowCount > 0) {
                    // A free class is already booked on this day
                    res.send({ error: 'You are not eligble for a free booking, as you have booked a free class on this day already.' });
                } else {
                    res.send({ applyDiscount: true });
                }
            } else {
                res.send({ error: 'no_membership' });
            }
        } else {
            res.send({ error: 'no_membership' });
        }
    })();
});

app.post('/api/sale', (req, res) => {
    (async function() {
        console.log(req.body.first_name);
        var items = JSON.parse(req.body.cart).items;
        var query = '', result = null;
        var ids = [], nonevents = [];

        // Loop through items, creating events for non classes
        for (var i in items) {
            if (items[i].type == 'open') {
                query = 'insert into event(name, service_id, date, recurrence_id, open_spots, total_spots, duration) values ' +
                        '(\'' + items[i].name + '\', ' + items[i].service_id + ',to_timestamp(' + items[i].epoch_date + ') at time zone \'UTC\', null, ' + (items[i].total_spots - 1) + ', ' + items[i].total_spots + ', ' + items[i].duration + ')';
                console.log('QUERY: ' + query);
                result = await DB_client.query(query);

                // Get the recently added event id
                query = 'select id from event where id=(select max(id) from event)';
                console.log('QUERY: ' + query);
                result = await DB_client.query(query);
                items[i].id = result.rows[0].id;
                ids.push(result.rows[0].id);
            } else if (items[i].type == 'nonevent') {
                // This item is a non event
                nonevents.push(items[i]);
            } else {
                ids.push(items[i].id);
            }
        }
        console.log(ids);
        console.log(nonevents);

        // Add each item as a new sale, and store the sale id
        var sales = [], total = 0;
        var freeUsed = false;
        for (var i in items) {

            query = 'select max(id) as id from sale';
            result = await DB_client.query(query);
            var saleID = result.rows[0].id + 1;

            if (items[i].type == 'open') {
                // Add to sale
                var price = (parseFloat(items[i].price.split('/')[0])*1.13).toFixed(2);
                total += price;
                query = 'insert into sale(id, user_id, first_name, last_name, email, phone, child_first_name, child_last_name, service_id, date, amount_due, event_id, free, price)' +
                        ' values(' + saleID + ',' + req.body.user_id + ',\'' + req.body.first_name + '\',\'' + req.body.last_name + '\',\'' + req.body.email + '\',\'' +
                        req.body.phone + '\',\'' + req.body.child_first_name + '\',\'' + req.body.child_last_name + '\',' + items[i].service_id + ',' +
                        'to_timestamp(' + items[i].epoch_date + ') at time zone \'UTC\',' + price + ',' + items[i].id + ',' + (freeUsed ? false : (items[i].type == 'class' ? req.body.free : false)) + ',' + price + ')';
                console.log('QUERY: ' + query);
                result = await DB_client.query(query);
                sales.push(saleID);
                freeUsed = req.body.free;
            } else if (items[i].type == 'class') {
                // If the item is a class, decrement the open spots
                query = 'update event set open_spots = (open_spots - 1) where id = ' + items[i].id;
                console.log('QUERY: ' + query);
                result = await DB_client.query(query);

                // Add to sale
                var price = (parseFloat(items[i].price.split('/')[0])*1.13).toFixed(2);
                total += price;
                query = 'insert into sale(id, user_id, first_name, last_name, email, phone, child_first_name, child_last_name, service_id, date, amount_due, event_id, free, price)' +
                        ' values(' + saleID + ',' + req.body.user_id + ',\'' + req.body.first_name + '\',\'' + req.body.last_name + '\',\'' + req.body.email + '\',\'' +
                        req.body.phone + '\',\'' + req.body.child_first_name + '\',\'' + req.body.child_last_name + '\',' + items[i].service_id + ',' +
                        'to_timestamp(' + items[i].epoch_date + ') at time zone \'UTC\',' + price + ',' + items[i].id + ',' + (freeUsed ? false : (items[i].type == 'class' ? req.body.free : false)) + ',' + price + ')';
                console.log('QUERY: ' + query);
                result = await DB_client.query(query);
                sales.push(saleID);
                freeUsed = req.body.free;
            }
        }

        // Handle non-events
        var nonevent = false;
        for (var i in nonevents) {
            if (nonevents[i].eventType == 'membership') {
                nonevent = true;
                // Handle purchasing of new membership
                // Get current user membership level
                var payload = getPayload(req.body.token);
                var query = '';
                if (payload.membership == nonevents[i].id) {
                    // User is cancelling membership
                    console.log('cancel membership');
                } else if (payload.membership == 0) {
                    // User is joining with a new membership
                    console.log('join ' + nonevents[i].id + ' membership');
                } else if (payload.membership < nonevents[i].id) {
                    // User is upgrading membership
                    console.log('upgrade to ' + nonevents[i].id + ' membership');
                } else {
                    // User is downgrading membership
                    console.log('downgrade to ' + nonevents[i].id + ' membership');
                }
            }
        }

        if (!nonevent) {
        // Generate a new basket
        query = 'insert into basket(sales, items) values(\'{' + sales + '}\',\'{' + ids + '}\')';
        console.log('QUERY: ' + query);
        result = await DB_client.query(query);

        // Send the receipt email to the user and to the owner
        sendEmail(req.body.email, req.body.first_name, req.body.last_name, items);
        }

        res.send({ error: null, total: total });
    })();
});

app.post('/api/getAllUsers', (req, res) => {
    (async function() {
        var payload = getPayload(req.body.token);
        if (payload.admin) {
            var query = 'select * from users order by id asc';
            var result = await DB_client.query(query);
            res.send({ users: result.rows });
        } else {
            res.sendStatus(403);
        }
    })();
});

app.post('/api/storeTotal', (req, res) => {
    (async function() {
        var query = 'update staging set total = ' + req.body.total + ' where id = 1';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);

        res.send({ error: null });
    })();
});

function sendEmail(email, first_name, last_name, items) {
    var msg = first_name[0].toUpperCase() + first_name.substr(1) + ', You have ordered the following items at Cosgrove Hockey Academy.';
    var ownerMsg = first_name[0].toUpperCase() + first_name.substr(1) + ' ' + last_name[0].toUpperCase() + last_name.substr(1) + ' has ordered the following items.';


    var html = '<html><head><style>body {color: black; width: 30%; margin: 0 auto; font-family: \'Arial\';' +
            'text-align: center;}table {width: 100%;border-spacing: 0;}thead th {padding: 1%;}table thead {color: white;background: #343a40;}' +
            'tbody tr:nth-of-type(odd) {background: rgba(0,0,0,.05);}tbody td{padding: 2%;}#small-container {text-align: left;width: 100%;' +
            'margin: 0 auto;margin-top: 1%;font-size: 90%;}h2 {margin-bottom: 0;}p {margin-top: 0;}</style></head><body>' +
            '<img src="https://ci6.googleusercontent.com/proxy/tlmwj8qAsiGEAZ5hkcdLxI0Y0hjtePXl6QkMfBcwNZuCaYEbd7FrVomF5EyLu6vdmirpBUzBIQ=s0-d-e1-ft#https://i.ibb.co/7NR413V/logo-lg.png"' +
            'width="600" class="CToWUd a6T" tabindex="0"><h2>Receipt</h2><p>' + msg + '</p><table style="margin:0 auto"><thead><tr><th>Item</th><th>Date</th><th>Time</th><th>Price</th></tr></thead><tbody>';
    var ownerHtml = '<html><head><style>body {width: 30%; margin: 0 auto; font-family: \'Arial\';' +
            'text-align: center;}table {width: 100%;border-spacing: 0;}thead th {padding: 1%;}table thead {color: white;background: #343a40;}' +
            'tbody tr:nth-of-type(odd) {background: rgba(0,0,0,.05);}tbody td{padding: 2%;}#small-container {text-align: left;width: 100%;' +
            'margin: 0 auto;margin-top: 1%;font-size: 90%;}h2 {margin-bottom: 0;}p {margin-top: 0;}</style></head><body>' +
            '<img src="https://ci6.googleusercontent.com/proxy/tlmwj8qAsiGEAZ5hkcdLxI0Y0hjtePXl6QkMfBcwNZuCaYEbd7FrVomF5EyLu6vdmirpBUzBIQ=s0-d-e1-ft#https://i.ibb.co/7NR413V/logo-lg.png"' +
            'width="600" class="CToWUd a6T" tabindex="0"><h2>Sale</h2><p>' + ownerMsg + '</p><table style="margin:0 auto"><thead><tr><th>Item</th><th>Date</th><th>Time</th><th>Price</th></tr></thead><tbody>';

    for (var i in items) {
        var itemDate = new Date(items[i].epoch_date*1000);
        items[i].date = dateString(itemDate);
        var start = time(itemDate);
        itemDate.setUTCMinutes(itemDate.getUTCMinutes() + (items[i].duration*60));
        items[i].time = start + ' - ' + time(itemDate);

        html += '<tr><td>' + items[i].name + '</td><td>' + items[i].date + '</td><td>' + items[i].time + '</td><td>' + items[i].price + '</td></tr>';
        ownerHtml += '<tr><td>' + items[i].name + '</td><td>' + items[i].date + '</td><td>' + items[i].time + '</td><td>' + items[i].price + '</td></tr>';
    }
    // Create a timestamp
    var today = new Date(toUTCTime(new Date().getTime()));
    var timestamp = 'Sent on ' + today.getUTCDate() + '/' + today.getUTCMonth() + '/' + today.getUTCFullYear() + ' at ' + today.getUTCHours() + ':' + today.getUTCMinutes() + ':' + today.getUTCSeconds();
    html += '</tbody></table><div id="small-container"><small>' + timestamp + '</small></div></body></html>';
    ownerHtml += '</tbody></table><div id="small-container"><small>' + timestamp + '</small></div></body></html>';
  
    // Gmail transporter setup
    var transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
          user: 'noreply.cosgrovehockey@gmail.com',
          pass: 'mplkO0935'
      }
    });

    // Send email to owner
    /*var mailOptions = {
        from: 'noreply.cosgrovehockey@gmail.com',
        to: 'cosgrovehockeyacademy@gmail.com',
        subject: 'Cosgrove Hockey Academy - Online Sale',
        html: ownerHtml
    };
    // Send the email
    transporter.sendMail(mailOptions, function (err, info) {
        if(err)
          console.log(err);
        else
          console.log(info);
    });*/

    // Send email to user
    var mailOptions = {
        from: 'noreply.cosgrovehockey@gmail.com',
        to: email,
        subject: 'Cosgrove Hockey Academy - Receipt',
        html: html
    };
    // Send the email
    transporter.sendMail(mailOptions, function (err, info) {
        if(err)
          return 'An error has occurred while sending an email.';
        else
          return true;
    });
}

// End - API
/*https.createServer({
    key: fs.readFileSync('server-key.pem'),
    cert: fs.readFileSync('server-cert.pem')
  }, app).listen(port, () => {
    console.log('Listening on port ' + port + '...');
});*/

app.listen(port, () => {
    console.log('Listening on port ' + port);
});