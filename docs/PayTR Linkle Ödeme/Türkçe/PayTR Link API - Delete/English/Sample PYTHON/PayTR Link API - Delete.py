# Python 3.6+


import base64
import hmac
import hashlib
import requests
import json
import random


merchant_id = 'AAAAAA'
merchant_key = b'AAAAAA'
merchant_salt = 'XXXXXXXXXXXXXXXX'


id = 'YYYXXX'

debug_on=1




hash_str = id + merchant_id + merchant_salt
paytr_token = base64.b64encode(hmac.new(merchant_key, hash_str.encode(), hashlib.sha256).digest())

params = {
    'merchant_id': merchant_id,
    'id': id,
    'debug_on': debug_on,
    'paytr_token': paytr_token
}

result = requests.post('https://www.paytr.com/odeme/api/link/delete', params)
res = json.loads(result.text)

if res['status'] == 'error':
    print('Error: ' + res['err_msg'])
elif res['status'] == 'failed':
    print(result.text)
else:
    print(result.text)
    
    