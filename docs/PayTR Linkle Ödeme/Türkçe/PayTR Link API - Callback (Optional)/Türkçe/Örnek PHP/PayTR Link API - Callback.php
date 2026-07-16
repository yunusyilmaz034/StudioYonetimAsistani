<?php

    ############################# ÖDEME LİNKİ BİLDİRİM ÖRNEK KODLAR ############################
    #                                                                                          #
    $post = $_POST;

    ################################ DÜZENLEMESİ ZORUNLU ALANLAR ###############################
    #
    ## API Entegrasyon Bilgileri - Mağaza paneline giriş yaparak BİLGİ sayfasından alabilirsiniz.
    $merchant_key   = 'XXXXXXXXXXXXXXXX';
    $merchant_salt  = 'XXXXXXXXXXXXXXXX';
    ############################################################################################

    ################ Bu kısımda herhangi bir değişiklik yapmanıza gerek yoktur. ################
    #
    ## POST değerleri ile hash oluştur.
    $hash = base64_encode( hash_hmac('sha256', $post['callback_id'].$post['merchant_oid'].$merchant_salt.$post['status'].$post['total_amount'], $merchant_key, true) );
    #
    ## Oluşturulan hash'i, paytr'dan gelen post içindeki hash ile karşılaştır (isteğin paytr'dan geldiğine ve değişmediğine emin olmak için)
    ## Bu işlemi yapmazsanız maddi zarara uğramanız olasıdır.
    if( $hash != $post['hash'] )
        die('PAYTR notification failed: bad hash');
    ############################################################################################
    #
    ## BURADA YAPILMASI GEREKENLER
    ## 1) Ödeme durumunu $post['callback_id'] değerini kullanarak veri tabanınızdan sorgulayın.
    ## 2) Eğer ödeme zaten daha önceden onaylandıysa (callback size ulaştıysa) sadece echo "OK"; exit; yaparak akışı sonlandırın.
    /* Ödeme durum sorgulama örnek
       $durum = SQL
       if($durum == "onay"){
            echo "OK";
            exit;
        }
     */

    if( $post['status'] == 'success' ) { ## Ödeme Onaylandı
        ## BURADA YAPILMASI GEREKENLER
        ## 1) Veri tabanınızda ödemeyi onaylayın.
        ## 2) Eğer müşterinize mesaj / SMS / e-posta gibi bilgilendirme yapacaksanız bu aşamada yapmalısınız.
        ## 3) $post['total_amount'] müşterinin yaptığı ödemenin toplam tutarıdır. Muhasebe işlemlerinizde
        ## bu tutraı kullanmanız gerekmektedir.
    } else {
        ## Link API'de başarısız ödemeler için callback yapılmamaktadır.
        ## Dolayısıyla kod akışında buraya erişim olmayacaktır. Ancak ileride Link API'de yapılabilecek geliştirmeler
        ## için dilerseniz buraya bir handler yazabilirsiniz.
    }

    ## Bildirimin alındığını PayTR sistemine bildir. OK yanıtını bu alandan kaldırmayın.
    echo "OK";
    exit;