var crypto = require('crypto');
var express = require('express');
var app = express();
var request = require('request');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

var merchant_id = 'AAAAAA';
var merchant_key = 'XXXXXXXXXXXXXXXX';
var merchant_salt = 'XXXXXXXXXXXXXXXX';





app.get("/create", function (req, res) {

    var name = 'Örnek Ürün / Hizmet Adı';  // Product or Service Name
    var price = '1445'; // Payment amount
    var currency = 'TL';  
    var max_installment = '12'; //Specifies the maximum number of installments to be displayed (example usage: up to 4 installments is allowed for jewellery expenditures)
    var link_type = 'product';
    var lang = 'tr'; //tr or en.
    var required = name + price + currency + max_installment + link_type + lang;
    var email = '';
    var min_count = '';
    if (link_type == 'product') {
        min_count = '1';
       // Minimum quantity limit. (it is required if link type is product)
        required += min_count;
    } else {
        (link_type == 'collection')
        email = 'test@example.com';
        //E-mail address (it is required if link type is collection).
        required += email;
    }

    var max_count = '1';
    var expiry_date = '2021-06-23 17:00:00';

    // Link's expiration date. If not sent, it remains open until deleted
    // Example format: 2021-05-31 17:00:00



    var callback_link = '';
    // Notification ID to return in notification. This field is required when the callback_link is sent
    var callback_id = '';
    var debug_on = '1'; //Error message (Be sure to send 1 to detect errors during the integration and testing process)


    var paytr_token = crypto.createHmac('sha256', merchant_key).update(required + merchant_salt).digest('base64');

    var options = {
        'method': 'POST',
        'url': 'https://www.paytr.com/odeme/api/link/create',
        'headers': {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        form: {
            'merchant_id': merchant_id,
            'name': name,
            'price': price,
            'currency': currency,
            'max_installment': max_installment,
            'link_type': link_type,
            'lang': lang,
            'min_count': min_count,
            'email': email,
            'expiry_date': expiry_date,
            'max_count': max_count,
            'callback_link': callback_link,
            'callback_id': callback_id,
            'debug_on': debug_on,
            'paytr_token': paytr_token,
        }
    };

    request(options, function (error, response, body) {
        if (error) throw new Error(error);
        var res_data = JSON.parse(body);

        if (res_data.status == 'success') {
            res.send(body);
        } else {

            res.end(body);
        }


    });

});




app.get("/delete", function (req, res) {

    var id = 'XXXX'; //  It is the value returned in the create method.
    var debug_on = '1'; 

    var paytr_token = crypto.createHmac('sha256', merchant_key).update(id + merchant_id + merchant_salt).digest('base64');


    var options = {
        'method': 'POST',
        'url': 'https://www.paytr.com/odeme/api/link/delete',
        'headers': {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        form: {
            'merchant_id': merchant_id,
            'id': id,
            'debug_on': debug_on,
            'paytr_token': paytr_token,
        }
    };

    request(options, function (error, response, body) {
        if (error) throw new Error(error);
        var res_data = JSON.parse(body);

        if (res_data.status == 'success') {
            res.send(response.body);

            /* 
            [status]  => success
            */

        } else {
            console.log(response.body);
            res.end(response.body);
        }


    });

});


app.get("/sendsms", function (req, res) {

    var id = 'XXXX';  //  It is the value returned in the create method.
    var cell_phone = '05555555555'; // Phone information you want to send the link to
    var debug_on = '1'; 

    var paytr_token = crypto.createHmac('sha256', merchant_key).update(id + merchant_id + cell_phone + merchant_salt).digest('base64');


    var options = {
        'method': 'POST',
        'url': 'https://www.paytr.com/odeme/api/link/send-sms',
        'headers': {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        form: {
            'merchant_id': merchant_id,
            'id': id,
            'cell_phone': cell_phone,
            'debug_on': debug_on,
            'paytr_token': paytr_token,
        }
    };

    request(options, function (error, response, body) {
        if (error) throw new Error(error);
        var res_data = JSON.parse(body);

        if (res_data.status == 'success') {
            res.send(response.body);

        } else {
            console.log(response.body);
            res.end(response.body);
        }


    });

});


app.get("/sendmail", function (req, res) {

    var id = 'XXXX'; //  It is the value returned in the create method.
    var email = ''; // Email information you want to send the link to
    var debug_on = '1'; 

    var paytr_token = crypto.createHmac('sha256', merchant_key).update(id + merchant_id + email + merchant_salt).digest('base64');


    var options = {
        'method': 'POST',
        'url': 'https://www.paytr.com/odeme/api/link/send-email',
        'headers': {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        form: {
            'merchant_id': merchant_id,
            'id': id,
            'email': email,
            'debug_on': debug_on,
            'paytr_token': paytr_token,
        }
    };

    request(options, function (error, response, body) {
        if (error) throw new Error(error);
        var res_data = JSON.parse(body);

        if (res_data.status == 'success') {
            res.send(response.body);

        } else {
            console.log(response.body);
            res.end(response.body);
        }


    });

});



app.post("/callback", function (req, res) {
    var callback = req.body;


    token = callback.id + callback.merchant_oid + merchant_salt + callback.status + callback.total_amount;
    var paytr_token = crypto.createHmac('sha256', merchant_key).update(token).digest('base64');

    if (paytr_token != callback.hash) {
        throw new Error("PAYTR notification failed: bad hash");
    }
        ////////////////////////////////////////////////////////////////////////////////////////////
        //
        //
        ////////////////////////////// Returned values in POST //////////////////////////////
        // [hash]            => The hash information to be used for verification.
        // [merchant_oid]    => Order reference number generated by PayTR.
        // [status]          => If the payment is successful, it gets value as success. (In Link API, there is no callback for unsuccessful payments).
        // [total_amount]    => Total payment amount (For example, if the payment is made in installments, the amount will be different from payment_amount.)
        // [payment_amount]  => It is the "payment_amount" value that you send in the 1st step.
        // [payment_type]    => This value indicates which payment method the customer used to pay. (  card, bex etc. )
        // [currency]        => It indicates which currency is used for payment. (‘TL’, ‘USD’, ‘EUR’, ‘GBP’, ‘RUB’)
        // [callback_id]     => Callback_id from create service
        // [merchant_id]     => PayTR merchant number.
        // [test_mode]       => If your merchant is in test mode, it returns as 1.
        ////////////////////////////////////////////////////////////////////////////////////////////
    if (callback.status == 'success') {
      //  If the payment is successful, you should take action in this area.
    } else {
        //Payment is not Confirmed
    }

    res.send('OK');


});

var port = 3200;
app.listen(port, function () {
    console.log("Server is running. Port:" + port);
});
