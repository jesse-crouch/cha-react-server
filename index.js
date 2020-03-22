const express = require('express');
const { Client } = require('pg');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const hash = require('crypto-js');
const nodemailer = require('nodemailer');

// Set your secret key. Remember to switch to your live secret key in production!
// See your keys here: https://dashboard.stripe.com/account/apikeys
const stripe = require('stripe')('sk_test_I86H6VkUjtbDN5B7304wBpyw00nChfGgPw');

const app = express();

const port = 3500;
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
app.get('/api/serverURL', (req, res) => {
    res.send({ server: 'http://localhost:3500' });
});

app.post('/api/getServices', (req, res) => {
    (async function() {
        if (req.body.id != undefined) {
            // Get a list of all child services
            var query = 'select * from service where parent_service_id = ' + req.body.id;
            console.log('QUERY: ' + query);
            var result = await DB_client.query(query);
            if (result.rowCount > 0) {
                res.send({ services: result.rows });
            } else {
                // This is the last service in the chain
                res.send({ services: [] });
            }
        } else {
            // Get a list of all parent services
            var query = 'select * from service where parent_service_id is null';
            console.log('QUERY: ' + query);
            var result = await DB_client.query(query);
            res.send({ services: result.rows });
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

            var query = 'select e.*, extract(epoch from date) as epoch_date, concat(i.first_name, \' \', i.last_name) as instructor_name from event e, instructor i, service s where service_id = ' + req.body.id + ' and s.id = ' + req.body.id + ' and i.id = s.instructor and (extract(epoch from date)*1000) between ' + start + ' and ' + end;
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

        var services = [];
        while (serviceResult.rows[0].parent_service_id != null) {
            query = 'select s.name from service s where id = ' + serviceResult.rows[0].parent_service_id;
            console.log('QUERY: ' + query);
            serviceResult = await DB_client.query(query);
            services.push(serviceResult.rows[0]);
        }
        var fullServiceName = '';
        for (var i=services.length-1; i>-1; i--) {
            fullServiceName += services[i].name + ' - ';
        }
        fullServiceName += baseService.name;
        baseService.fullServiceName = fullServiceName;

        // If this is a class, determine the first instance
        var startDate = new Date(req.body.date*1000);
        console.log(req.body.date + ',' + startDate);
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

            // Add the service info to each event
            for (var i in eventResult.rows) {
                eventResult.rows[i].service = baseService;
            }

            res.send({
                service_info: baseService,
                events: eventResult.rows,
                startDate: startDate.getTime()
            });
        }
    })();
});

app.post('/api/getEventManagerEvents', (req, res) => {
    (async function() {
        var query = 'select e.*, extract(epoch from date) as epoch_date, s.type from event e, service s where s.id = e.service_id order by date asc';
        console.log('QUERY: ' + query);
        var result = DB_client.query(query);
        res.send({
            events: result.rows
        });
    })();
});

app.post('/api/getEvent', (req, res) => {
    (async function() {
        var query = 'select e.*, s.duration, extract(epoch from date) as epoch_date from event e, service s where e.id = ' + req.body.id + ' and s.id = e.service_id';
        console.log('QUERY: ' + query);
        var result = await DB_client.query(query);

        if (result.rowCount > 0) {
            res.send({
                event: {
                    id: result.rows[0].id,
                    event_name: result.rows[0].name,
                    epoch_date: result.rows[0].epoch_date,
                    duration: result.rows[0].duration
                }
            });
        } else {
            res.send({ error: 'No event found in DB' });
        }
    })();
});

app.post('/api/addEvent', (req, res) => {
    // TODO
});

app.post('/api/getPayload', (req, res) => {
    var payload = jwt.verify(req.body.token, secret_key);
    res.send({
        payload: payload
    });
});

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
            if (user.passChanged) {
                if (hashed == user.password) {
                    // Passwords match, generate a token and send to client
                    res.send({ token: generateToken(user) });
                } else {
                    // Passwords don't match, send result to client
                    res.send({ error: 'Incorrect password, please try again.' });
                }
            } else {
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

function generateToken(user) {
    return jwt.sign({
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        membership: user.membership
    }, secret_key);
}

app.post('/api/testEmail', (req, res) => {
    var result = sendEmail(req.body.email, req.body.first_name, req.body.last_name, req.body.items);
    if (result) {
        res.send({ success: result });
    } else {
        res.send({ error: result });
    }
});

app.post('/api/getClientSecret', (req, res) => {
    (async () => {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: req.body.amount*100,
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
    // Loop through items, creating events for non classes
    /*var allIDs = [];
    for (var i in req.body.items) {
        if (req.body.items[i].type == 'class') {
            
        }
    }

    first_name: first_name,
                    last_name: last_name,
                    email: email,
                    phone: phone,
                    child_first_name: child_first_name,
                    child_last_name: child_last_name,
                    items: itemIDs,
                    amount_due: 0

     sale in db
     id, user_id, first_name, last_name, email, phone, c_first_name, c_last_name, service_id, date, amount_due, calendar_event_id, free, services
    'insert into sale (user_id, first_name, last_name, email, phone, c_first_name, c_last_name, service_id, date, amount_due, calendar_event_id, free, services)' +
    'values (req.body.user_id, req.body.first_name, req.body.last_name, req.body.email, req.body.phone, req.body.c_first_name, items[i].id, '*/
})

function sendEmail(email, first_name, last_name, items) {
    var msg = first_name[0].toUpperCase() + first_name.substr(1) + ', You have ordered the following items at Cosgrove Hockey Academy.';
    var ownerMsg = first_name[0].toUpperCase() + first_name.substr(1) + ' ' + last_name[0].toUpperCase() + last_name.substr(1) + ' has ordered the following items.';

    var html = '<html><head><link href="https://stackpath.bootstrapcdn.com/bootstrap/4.4.1/css/bootstrap.min.css" ' +
                'rel="stylesheet" integrity="sha384-Vkoo8x4CGsO3+Hhxv8T/Q5PaXtkKtu6ug5TOeNV6gBiFeWPGFN9MuhOf23Q9Ifjh" ' +
                'crossorigin="anonymous"><script src="https://stackpath.bootstrapcdn.com/bootstrap/4.4.1/js/bootstrap.min.js" ' +
                'integrity="sha384-wfSDF2E50Y2D1uUdj0O3uMBJnjuUD4Ih7YwaYd1iqfktj0Uod8GCExl3Og8ifwB6" crossorigin="anonymous">' +
                '</script></head><div class="text-center"><img src="https://i.ibb.co/7NR413V/logo-lg.png" width="600"/><h4>' +
                'Receipt</h4><p>' + msg + '</p></div><table class="table table-striped" style="margin: 0 auto;"><thead class="thead thead-dark"><tr><th>Item</th><th>Time' +
                '</th><th>Price</th></tr></thead><tbody></html>';
    var ownerHtml =  '<html><head><link href="https://stackpath.bootstrapcdn.com/bootstrap/4.4.1/css/bootstrap.min.css" ' +
                'rel="stylesheet" integrity="sha384-Vkoo8x4CGsO3+Hhxv8T/Q5PaXtkKtu6ug5TOeNV6gBiFeWPGFN9MuhOf23Q9Ifjh" ' +
                'crossorigin="anonymous"><script src="https://stackpath.bootstrapcdn.com/bootstrap/4.4.1/js/bootstrap.min.js" ' +
                'integrity="sha384-wfSDF2E50Y2D1uUdj0O3uMBJnjuUD4Ih7YwaYd1iqfktj0Uod8GCExl3Og8ifwB6" crossorigin="anonymous">' +
                '</script></head><div class="text-center"><img src="https://i.ibb.co/7NR413V/logo-lg.png" width="600"/><h4>' +
                'Receipt</h4><p>' + ownerMsg + '</p></div><table class="table table-striped" style="margin: 0 auto;"><thead class="thead thead-dark"><tr><th>Item</th><th>Time' +
                '</th><th>Price</th></tr></thead><tbody></html>';
    items = JSON.parse(items);
    for (var i in items) {
        html += '<tr><td>' + items[i].event_name + '</td><td>' + items[i].time + '</td><td>' + items[i].price + '</td></tr>';
        ownerHtml += '<tr><td>' + items[i].event_name + '</td><td>' + items[i].time + '</td><td>' + items[i].price + '</td></tr>';
    }
    // Create a timestamp
    var today = new Date();
    var timestamp = 'Sent on ' + today.getUTCDate() + '/' + today.getUTCMonth() + '/' + today.getUTCFullYear() + ' at ' + today.getUTCHours() + ':' + today.getUTCMinutes() + ':' + today.getUTCSeconds();
    html += '</tbody></table><div class="text-center mt-4"><small>' + timestamp + '</small></div>';
    ownerHtml += '</tbody></table><div class="text-center mt-4"><small>' + timestamp + '</small></div>';
  
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

app.listen(port, () => {
    console.log('Listening on port ' + port + '...');
});