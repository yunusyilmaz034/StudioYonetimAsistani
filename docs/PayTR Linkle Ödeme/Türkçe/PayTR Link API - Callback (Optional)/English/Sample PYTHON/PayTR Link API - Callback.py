# Python 3.6+
# Based on the Django Web Framework


import base64
import hashlib
import hmac
import json

from django.shortcuts import render, HttpResponse
from django.views.decorators.csrf import csrf_exempt

@csrf_exempt
def callback(request):
    if request.method != 'POST':
        return HttpResponse(str(''))

    post = request.POST


    merchant_key = b'XXXXXXXXXXXXXXXX'
    merchant_salt = 'XXXXXXXXXXXXXXXX'

 
    hash_str = post['callback_id'] + post['merchant_oid'] + merchant_salt + post['status'] + post['total_amount']
    hash = base64.b64encode(hmac.new(merchant_key, hash_str.encode(), hashlib.sha256).digest())


    if hash != post['hash']:
        return HttpResponse(str('PAYTR notification failed: bad hash'))



    if post['status'] == 'success':


    else:


 
    return HttpResponse(str('OK'))