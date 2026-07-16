# Python 3.6+
# Django Web Framework referans alınarak hazırlanmıştır
# ÖDEME LİNKİ BİLDİRİM ÖRNEK KODLAR

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

    # API Entegrasyon Bilgileri - Mağaza paneline giriş yaparak BİLGİ sayfasından alabilirsiniz.
    merchant_key = b'XXXXXXXXXXXXXXXX'
    merchant_salt = 'XXXXXXXXXXXXXXXX'

    # Bu kısımda herhangi bir değişiklik yapmanıza gerek yoktur.
    # POST değerleri ile hash oluştur.
    hash_str = post['callback_id'] + post['merchant_oid'] + merchant_salt + post['status'] + post['total_amount']
    hash = base64.b64encode(hmac.new(merchant_key, hash_str.encode(), hashlib.sha256).digest())

    # Oluşturulan hash'i, paytr'dan gelen post içindeki hash ile karşılaştır
    # (isteğin paytr'dan geldiğine ve değişmediğine emin olmak için)
    # Bu işlemi yapmazsanız maddi zarara uğramanız olasıdır.
    if hash != post['hash']:
        return HttpResponse(str('PAYTR notification failed: bad hash'))

    """
    BURADA YAPILMASI GEREKENLER
    1) Ödeme durumunu post['callback_id'] değerini kullanarak veri tabanınızdan sorgulayın.
    2) Eğer ödeme zaten daha önceden onaylandıysa (callback size ulaştıysa) sadece 'OK' yaparak akışı sonlandırın.
    Ödeme durum sorgulama örnek
    durum = SQL
    
    if(durum == 'onay'){
         return HttpResponse(str('OK'))
    """

    if post['status'] == 'success':
        """
        BURADA YAPILMASI GEREKENLER
        1) Veri tabanınızda ödemeyi onaylayın.
        2) Eğer müşterinize mesaj / SMS / e-posta gibi bilgilendirme yapacaksanız bu aşamada yapmalısınız.
        3) post['total_amount'] müşterinin yaptığı ödemenin toplam tutarıdır. Muhasebe işlemlerinizde
        bu tutraı kullanmanız gerekmektedir.
        """
    else:
        """
        Link API'de başarısız ödemeler için callback yapılmamaktadır.
        Dolayısıyla kod akışında buraya erişim olmayacaktır. Ancak ileride Link API'de yapılabilecek geliştirmeler
        """

    # Bildirimin alındığını PayTR sistemine bildir.
    return HttpResponse(str('OK'))