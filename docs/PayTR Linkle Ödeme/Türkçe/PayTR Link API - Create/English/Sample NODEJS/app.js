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

    var name = 'Örnek Ürün / Hizmet Adı';  // Ürün / Hizmetin açıklaması. En az 4 en fazla 200 karakter.
    var price = '1445'; // 14.45 TL için 14.45 * 100 = 1445 (100 ile çarpılmış ve integer olarak gönderilmelidir.)
    var currency = 'TL';  //TL - USD - EUR - GBP gönderilebilir.
    var max_installment = '12'; // 2 - 12 arası gönderilebilir. 1 gönderilirse bireysel kartlar taksit yapılamaz.

    //collection (fatura/cari tahsilat) veya product (ürün/hizmet satışı) gönderilebilir.
    //collection ise email (ödeme yapan tarafın eposta adresi olmalı).
    //product ise min_count (satın alma adet alt limiti) gereklidir.

    var link_type = 'product';
    var lang = 'tr'; //tr veya en gönderilebilir.
    var required = name + price + currency + max_installment + link_type + lang;
    var email = '';
    var min_count = '';
    if (link_type == 'product') {
        min_count = '1';
        // Alt adet limiti.
        required += min_count;
    } else {
        (link_type == 'collection')
        email = 'test@example.com';
        // Ödeme yapan kullanıcının eposta adresi.
        required += email;
    }

    var max_count = '1';

    // Opsiyonel bilgiler, gönderilmesi zorunlu değildir.

    var expiry_date = '2021-06-23 17:00:00';

    // Link'in son kullanma tarihi. Gönderilmezse, sürekli açık kalır.
    // Örnek format: 2021-05-31 17:00:00
    
    
    var pft ='0'; 
    
    // 2 - 12 arası gönderilebilir. Gönderilen en yüksek sayıya kadar olan tüm taksit seçenekleri Peşin Fiyatına Taksit olarak ayarlanır.
    // DİKKAT: Peşin Fiyatına Taksit olarak belirlediğiniz taksit sayıları için yapılan tüm ödeme işlemlerinde, taksit komisyonları sizden kesilecektir.
    
    var callback_link = '';

    //Link ile yapılan ödemenin sonucunun gönderileceği URL. En fazla 400 kararkter.
    //http:// ya da https:// ile başlamalı, localhost olmamalı ve port içermemelidir.
    //callback_id gönderildiğinde bu alan zorunlu olmaktadır.

    var callback_id = '';

    // Bildirimde dönülecek bildirim ID'si. Alfanumerik ve en fazla 64 karakter olabilir.
    //callback_link gönderildiğinde bu alan zorunlu olmaktadır.
    

    var debug_on = '1'; //Entegrasyon hatalarını alabilmek için 1 olarak bırakın.

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

    var id = 'XXXX'; // Link ID - create metodunda dönülen değerdir.
    var debug_on = '1'; // Hataları ekrana basmak için kullanılır.

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

            /* Başarılı yanıt içerik örneği
            [status]  => success
            */

        } else {
            console.log(response.body);
            res.end(response.body);
        }


    });


});


app.get("/sendsms", function (req, res) {

    var id = 'XXXX';  // Link ID - create metodunda dönülen değerdir.
    var cell_phone = '05555555555'; // SMS gönderilecek numara. 05 ile başlamalı ve 11 hane olmalıdır.
    var debug_on = '1'; // Hataları ekrana basmak için kullanılır.

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

    var id = 'XXXX'; // Link ID - create metodunda dönülen değerdir.
    var email = ''; // Eposta gönderilecek adres. Standart email adresi formatına uygun olmalıdır.
    var debug_on = '1'; // Hataları ekrana basmak için kullanılır.

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

    ////////////////////////////// POST İÇERİSİNDE DÖNEN DEĞERLER //////////////////////////////
    // [hash]            => Doğrulama yapmak için kullanılacak hash bilgisi.
    // [merchant_oid]    => PayTR tarafından oluşturulan sipariş referans numarası.
    // [status]          => Ödemenin başarılı durumunda success değeri alır(Link API'de başarısız ödemeler için callback yapılmamaktadır).
    // [total_amount]    => Toplam ödeme tutarı(Örneğin taksitli ödeme ise vade farklı toplam tutar).

    // [payment_amount]  => Ödeme tutarı.
    // [payment_type]    => Ödeme yöntemi.
    // [currency]        => Ödeme para birimi.
    // [callback_id]     => Link oluşturmada(create) ilettiğiniz callbak_id bilgisi.

    // [merchant_id]     => PayTR mağaza numaranınz.

    // [test_mode]       => Eğer mağazanız test modunda ise 1 döner.
    ////////////////////////////////////////////////////////////////////////////////////////////




    if (callback.status == 'success') {

        //basarili
    } else {
        /// basarisiz
    }

    res.send('OK');

});







var port = 3200;
app.listen(port, function () {
    console.log("Server is running. Port:" + port);
});
