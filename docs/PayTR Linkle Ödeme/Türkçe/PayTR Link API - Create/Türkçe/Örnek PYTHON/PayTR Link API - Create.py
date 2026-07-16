# Python 3.6+


import base64
import hmac
import hashlib
import requests
import json
import random


merchant_id = 'AAAAAA'
merchant_key = b'XXXXXXXXXXXXXXXX'
merchant_salt = 'XXXXXXXXXXXXXXXX'


name = 'Örnek Ürün / Hizmet Adı'
price           = '1445'
currency        = 'TL'
max_installment = '12'
link_type       = 'product'
lang            = 'tr'
email           =''
min_count       =''

required        = name + price + currency + max_installment + link_type + lang

if link_type == 'product':
    min_count = '1'

    required+=min_count
elif link_type == 'collection':
    email= random.randint(1, 9999999).__str__() + '@example.com'
   
    required+=email


expiry_date= '2021-03-23 17:00:00'
max_count='1'
pft=0
callback_link =''
callback_id=''
debug_on=1





hash_str = required + merchant_salt
paytr_token = base64.b64encode(hmac.new(merchant_key, hash_str.encode(), hashlib.sha256).digest())

params = {
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
    'paytr_token': paytr_token
}

result = requests.post('https://www.paytr.com/odeme/api/link/create', params)
res = json.loads(result.text)

if res['status'] == 'error':
    print('Error: ' + res['err_msg'])
elif res['status'] == 'failed':
    print(result.text)
else:
    print(result.text)
    
    