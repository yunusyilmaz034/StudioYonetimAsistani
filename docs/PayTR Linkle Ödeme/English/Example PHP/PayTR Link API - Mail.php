<?php

    ########################### SAMPLE CODES: SEND PAYMENT LINK BY EMAIL #########################

    ################################ REQUIRED FIELDS TO BE REGULATED ###############################
    #
    ## API - Information Integration  - You can get them from the information page after logging into the PayTR Merchant Panel.
    $merchant_id    = 'AAAAAA';
    $merchant_key   = 'XXXXXXXXXXXXXXXX';
    $merchant_salt  = 'XXXXXXXXXXXXXXXX';
    #

    ## Required informations
    #
    $id             = "XXXYYY";         // (Link ID) It is the value returned in the create method.
    $email          = "test@mail.com";  // The address to which the e-mail will be sent. It should conform to the standard email address format.
    $debug_on       = 1;                // Send as 1 to see integration and test errors
    #
    ############################################################################################

    ################ You do not need to make any changes in this part. ################
    #
    $paytr_token=base64_encode(hash_hmac('sha256', $id.$merchant_id.$email.$merchant_salt, $merchant_key, true));
    $post_vals=array(
        'merchant_id'       => $merchant_id,
        'id'                => $id,
        'email'             => $email,
        'debug_on'          => $debug_on,
        'paytr_token'       => $paytr_token
    );
    #
    ############################################################################################

    $ch=curl_init();
    curl_setopt($ch, CURLOPT_URL, "https://www.paytr.com/odeme/api/link/send-email");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_POST, 1) ;
    curl_setopt($ch, CURLOPT_POSTFIELDS, $post_vals);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, 0);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_FRESH_CONNECT, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    $result = @curl_exec($ch);

    if(curl_errno($ch))
        die("PAYTR LINK SEND MAIL API request timeout. err:".curl_error($ch));

    curl_close($ch);

    $result=json_decode($result,1);

    if($result['status']=='error')
        die($result['err_msg']);
    elseif($result['status']=='failed')
        print_r($result);
    else
        print_r($result);