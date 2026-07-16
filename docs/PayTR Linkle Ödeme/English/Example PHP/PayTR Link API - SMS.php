<?php

    ########################### SAMPLE CODES: SEND PAYMENT LINK BY SMS #########################

    ################################ REQUIRED FIELDS TO BE REGULATED ###############################
    #
    ## API - Information Integration  - You can get them from the information page after logging into the PayTR Merchant Panel.
    $merchant_id    = 'AAAAAA';
    $merchant_key   = 'XXXXXXXXXXXXXXXX';
    $merchant_salt  = 'XXXXXXXXXXXXXXXX';
    #

    ## Required Values
    #
    $id             = "XXXYYY";         // (Link ID) It is the value returned in the create method.
    $cell_phone     = "05000000000";    // The number to send the SMS. It should start with 05 and have 11 digits.
    $debug_on       = 1;                // Send as 1 to see integration and test errors
    #
    ############################################################################################

    ################ You do not need to make any changes in this part. ################
    #
    $paytr_token=base64_encode(hash_hmac('sha256', $id.$merchant_id.$cell_phone.$merchant_salt, $merchant_key, true));
    $post_vals=array(
        'merchant_id'       => $merchant_id,
        'id'                => $id,
        'cell_phone'        => $cell_phone,
        'debug_on'          => $debug_on,
        'paytr_token'       => $paytr_token
    );
    #
    ############################################################################################

    $ch=curl_init();
    curl_setopt($ch, CURLOPT_URL, "https://www.paytr.com/odeme/api/link/send-sms");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_POST, 1) ;
    curl_setopt($ch, CURLOPT_POSTFIELDS, $post_vals);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, 0);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_FRESH_CONNECT, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    $result = @curl_exec($ch);

    if(curl_errno($ch))
        die("PAYTR LINK SEND SMS API request timeout. err:".curl_error($ch));

    curl_close($ch);

    $result=json_decode($result,1);

    if($result['status']=='error')
        die($result['err_msg']);
    elseif($result['status']=='failed')
        print_r($result);
    else
        print_r($result);