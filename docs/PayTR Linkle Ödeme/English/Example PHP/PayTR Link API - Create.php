<?php

    ########################### SAMPLE CODES: CREATE PAYMENT LINK #########################
    #
    ################################ REQUIRED FIELDS TO BE REGULATED ###############################
    #
    ## API - Information Integration  - You can get them from the information page after logging into the PayTR Merchant Panel.
    $merchant_id    = 'AAAAAA';
    $merchant_key   = 'XXXXXXXXXXXXXXXX';
    $merchant_salt  = 'XXXXXXXXXXXXXXXX';
    #

    ## Required Values
    #
    $name            = "Sample Product / Service Name";
    # Description of the product or service. ( minimum 4 and maximum 200 characters required)
    #
    $price           = 1445;
    # 14.45 * 100 = 1445 for 14.45 TL (multiplied by 100 and must be sent as integer.)
    #
    $currency        = "TL";
    # TL, EUR, USD, GBP, RUB (If the value is null, TL is accepted)
    #
    $max_installment = "12";
    # It can be sent between 2 and 12. If 1 is sent, individual cards cannot be used for installments.
    #
    $link_type       = "product";
    # For product sale: "product" - For invoice / current collection: "collection"
    # If link_type is "collection", the e-mail address of the customer who will make the payment must be sent.
    # If link_type is a "product", min_count (minimum purchase count) is required.
    #
    $lang            = "tr";
    # "tr" or "en" can be sent.

    $required        = $name.$price.$currency.$max_installment.$link_type.$lang;

    if($link_type == "product"){
        $min_count     = "1";
        # Lower count limit.
        $required     .= $min_count;
    }elseif($link_type == "collection"){
        $email         = time()."@example.com";
        # the e-mail address of the customer who will make the payment 
        $required     .= $email;
    }

    ## Optional values is not required to be sent.
    #
    $expiry_date        = "2020-03-23 17:00:00";
    # Link's expiration date. If not sent, it remains open until deleted.
    # Example format: 2021-05-31 17:00:00
    #
    $max_count          = "1";
    # Available only in "product" mode.
    # It determines the stock quantity of the link. If not submitted, the stock limit is not applied.
    # When the payment is made according to the stock, the link becomes inactive.
    #
    #
    //$pft             = "0"; // OPTIONAL (Installment Cash Price setting)
    # 2 to 12 can be sent. All installment options up to the highest number sent are set as Installments to Cash Price.
    # ATTENTION: Installment commissions will be deducted from you in all payment
    # transactions made for the number of installments you have determined as Installments for Cash Price
    #
    #
    $callback_link      = "";
    # The URL where the result of the link payment will be sent.
    # callback_link	Must start with http: // or https: //, not contain localhost and port.
    # This field is required when the callback_id is sent.
    #
    $callback_id        = "";
    # It can be alphanumeric and up to 64 characters.
    # Notification ID to return in notification. This field is required when the callback_link is sent.

    $debug_on           = 1;
    # Send as 1 for integration and test errors
    #
    ############################################################################################

    ################ You do not need to make any changes in this part. ################
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