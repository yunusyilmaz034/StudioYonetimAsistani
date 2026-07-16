<?php

    ########################## ÖDEME LİNKİ OLUŞTURMAK İÇİN ÖRNEK KODLAR ########################
    #                                                                                          #
    ################################ DÜZENLEMESİ ZORUNLU ALANLAR ###############################
    #
    ## API Entegrasyon Bilgileri - Mağaza paneline giriş yaparak BİLGİ sayfasından alabilirsiniz.
    $merchant_id    = 'AAAAAA';
    $merchant_key   = 'XXXXXXXXXXXXXXXX';
    $merchant_salt  = 'XXXXXXXXXXXXXXXX';
    #

    ## Gerekli Bilgiler
    #
    $name            = "Örnek Ürün / Hizmet Adı";
    # Ürün / Hizmetin açıklaması. En az 4 en fazla 200 karakter.
    #
    $price           = 1445;
    # 14.45 TL için 14.45 * 100 = 1445 (100 ile çarpılmış ve integer olarak gönderilmelidir.)
    #
    $currency        = "TL";
    # TL - USD - EUR - GBP gönderilebilir.
    #
    $max_installment = "12";
    # 2 - 12 arası gönderilebilir. 1 gönderilirse bireysel kartlar taksit yapılamaz.
    #
    $link_type       = "product";
    # collection (fatura/cari tahsilat) veya product (ürün/hizmet satışı) gönderilebilir.
    # collection ise email (ödeme yapan tarafın eposta adresi olmalı).
    # product ise min_count (satın alma adet alt limiti) gereklidir.
    #
    $lang            = "tr";
    # tr veya en gönderilebilir.

    $required        = $name.$price.$currency.$max_installment.$link_type.$lang;

    if($link_type == "product"){
        $min_count     = "1";
        # Alt adet limiti.
        $required     .= $min_count;
    }elseif($link_type == "collection"){
        $email         = time()."@example.com";
        # Ödeme yapan kullanıcının eposta adresi.
        $required     .= $email;
    }

    ## Opsiyonel bilgiler, gönderilmesi zorunlu değildir.
    #
    $expiry_date        = "2020-03-23 17:00:00";
    # Link'in son kullanma tarihi. Gönderilmezse, sürekli açık kalır.
    # Örnek format: 2021-05-31 17:00:00
    #
    $max_count          = "1";
    # Yalnızca product modunda kullanılabilir.
    # Link'in stok adedini belirler. Gönderilmezse, stok limiti uygulanmaz.
    # Stok adedi kadar ödeme yapıldığında link pasif olur.
    #
    #
    //$pft             = "0"; // OPSİYONEL
    # 2 - 12 arası gönderilebilir. Gönderilen en yüksek sayıya kadar olan tüm taksit seçenekleri
    # Peşin Fiyatına Taksit olarak ayarlanır.
    # DİKKAT: Peşin Fiyatına Taksit olarak belirlediğiniz taksit sayıları için yapılan tüm
    # ödeme işlemlerinde, taksit komisyonları sizden kesilecektir.
    #
    #
    $callback_link      = "";
    # Link ile yapılan ödemenin sonucunun gönderileceği URL. En fazla 400 kararkter.
    # http:// ya da https:// ile başlamalı, localhost olmamalı ve port içermemelidir.
    # callback_id gönderildiğinde bu alan zorunlu olmaktadır.
    #
    $callback_id        = "";
    # Bildirimde dönülecek bildirim ID'si. Alfanumerik ve en fazla 64 karakter olabilir.
    # callback_link gönderildiğinde bu alan zorunlu olmaktadır.

    $debug_on           = 1;
    # Entegrasyon hatalarını alabilmek için 1 olarak bırakın.
    #
    ############################################################################################

    ################ Bu kısımda herhangi bir değişiklik yapmanıza gerek yoktur. ################
    #
    $paytr_token=base64_encode(hash_hmac('sha256', $required.$merchant_salt, $merchant_key, true));
    $post_vals=array(
        'merchant_id'       => $merchant_id,
        'name'              => $name,
        'price'             => $price,
        'currency'          => $currency,
        'max_installment'   => $max_installment,
        'link_type'         => $link_type,
        'lang'              => $lang,
        'min_count'         => $min_count,
        'email'             => $email,
        'expiry_date'       => $expiry_date,
        'max_count'         => $max_count,
        'pft'               => $pft,
        'callback_link'     => $callback_link,
        'callback_id'       => $callback_id,
        'debug_on'          => $debug_on,
        'paytr_token'       => $paytr_token
    );
    #
    ############################################################################################

    $ch=curl_init();
    curl_setopt($ch, CURLOPT_URL, "https://www.paytr.com/odeme/api/link/create");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_POST, 1) ;
    curl_setopt($ch, CURLOPT_POSTFIELDS, $post_vals);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, 0);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_FRESH_CONNECT, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    $result = @curl_exec($ch);

    if(curl_errno($ch))
        die("PAYTR LINK CREATE API request timeout. err:".curl_error($ch));

    curl_close($ch);

    $result=json_decode($result,1);

    if($result['status']=='error')
        die($result['err_msg']);
    elseif($result['status']=='failed')
        print_r($result);
    else
        print_r($result);