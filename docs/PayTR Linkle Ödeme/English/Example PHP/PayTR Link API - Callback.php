<?php

    ############################# PAYTR LINK API SAMPLE CODES ############################
    #
    $post = $_POST;

    ################################ REQUIRED FIELDS TO BE REGULATED ###############################
    #
    ## API Integration Information - You can get it from the INFORMATION page by logging into the PayTR Store Panel.
    $merchant_key   = 'XXXXXXXXXXXXXXXX';
    $merchant_salt  = 'XXXXXXXXXXXXXXXX';
    ############################################################################################

    ################ You do not need to make any changes in this part. ################
    #
    ## Hashing with POST values.
    $hash = base64_encode( hash_hmac('sha256', $post['callback_id'].$post['merchant_oid'].$merchant_salt.$post['status'].$post['total_amount'], $merchant_key, true) );
    #
    ## Checking whether the hash value in POST matches the hash value that will be generated using the values in POST is very important for security reasons. 
    ## This is necessary to ensure that the POST request comes from the PayTR system and the values do not change during request.  If you do not check hash value, you may face financial losses..
    if( $hash != $post['hash'] )
        die('PAYTR notification failed: bad hash');
    ############################################################################################
    #
    ## Here are what needs to be done.
    ## 1) Check the payment status from your database using ['callback_id'].
    ## 2) If the payment has already been confirmed (you received the callback) end the flow by sending just echo "OK";
    /* Example for payment status query 
       $status = SQL
       if($status == "confirm"){
            echo "OK";
            exit;
        }
     */

    if( $post['status'] == 'success' ) { ## Payment Confirmed
        ## Here are what needs to be done.
        ## 1) Confirm the payment in your database.
        ## 2) If you are going to inform your customer such as message / SMS / e-mail, you can do that at this part. You can access the data by saving the merchant_oid information and querying it at this part.
        ## 3) $post['total_amount'] is the total amount of the customer payment. You must use this amount in your accounting transactions.
    } else { ## Payment is not Confirmed
        ## There is no callback for unsuccessful payments in the Link API.
        ## So there will be no access here in the code stream. However, if you wish, you can write a handler here for future improvements to the Link API.
    }

    ## Notify the PayTR system that the notification has been received. Do not remove the OK answer from this field.
    echo "OK";
    exit;