using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Web;
using System.Net.Mail;
using System.Web.UI;
using System.Web.UI.WebControls;

public partial class paytr_link_api_callback : System.Web.UI.Page
{
    // ####################### DÜZENLEMESİ ZORUNLU ALANLAR #######################
    //
    // API Entegrasyon Bilgileri - Mağaza paneline giriş yaparak BİLGİ sayfasından alabilirsiniz.
    string merchant_key = "XXXXXXXXXXXXXXXXXXXXXXXXXX";
    string merchant_salt = "YYYYYYYYYYYYYYYYYYYYYYYYY";
    // ###########################################################################

    protected void Page_Load(object sender, EventArgs e)
    {
        // ####### Bu kısımda herhangi bir değişiklik yapmanıza gerek yoktur. #######
        // 
        // POST değerleri ile hash oluştur.
        string callback_id = Request.Form["callback_id"];
        string merchant_oid = Request.Form["merchant_oid"];
        string status = Request.Form["status"];
        string total_amount = Request.Form["total_amount"];
        string hash = Request.Form["hash"];

        string Birlestir = string.Concat(callback_id, merchant_oid, merchant_salt, status, total_amount);
        HMACSHA256 hmac = new HMACSHA256(Encoding.UTF8.GetBytes(merchant_key));
        byte[] b = hmac.ComputeHash(Encoding.UTF8.GetBytes(Birlestir));
        string token = Convert.ToBase64String(b);

        //
        // Oluşturulan hash'i, paytr'dan gelen post içindeki hash ile karşılaştır (isteğin paytr'dan geldiğine ve değişmediğine emin olmak için)
        // Bu işlemi yapmazsanız maddi zarara uğramanız olasıdır.
        if (hash.ToString() != token)
        {
            Response.Write("PAYTR notification failed: bad hash");
            return;
        }

        ////////////////////////////////////////////////////////////////////////////////////////////
        //
        //
        ////////////////////////////// POST İÇERİSİNDE DÖNEN DEĞERLER //////////////////////////////
        // [hash]            => Doğrulama yapmak için kullanılacak hash bilgisi.
        // [merchant_oid]    => PayTR tarafından oluşturulan sipariş referans numarası.
        // [status]          => Ödemenin başarılı durumunda success değeri alır(Link API'de başarısız ödemeler için callback yapılmamaktadır).
        // [total_amount]    => Toplam ödeme tutarı(Örneğin taksitli ödeme ise vade farklı toplam tutar).

        // [payment_amount]  => Ödeme tutarı.
        // [payment_type]    => Ödeme yöntemi.
        // [currency]        => Ödeme para birimi.
        // [callback_id]     => Link oluşturmada(create) ilettiğiniz callbak_id bilgisi.

        // [merchant_id]     => PayTR mağaza numaranınz.

        // [test_mode]       => Eğer mağazanız test modunda ise 1 döner.
        ////////////////////////////////////////////////////////////////////////////////////////////
        //

        // BURADA YAPILMASI GEREKENLER
        // 1) Ödeme durumunu ['callback_id'] değerini kullanarak veri tabanınızdan sorgulayın.
        // 2) Eğer ödeme zaten daha önceden onaylandıysa (callback size ulaştıysa) sadece echo "OK"; exit; yaparak akışı sonlandırın.

        /* Ödeme durum sorgulama örnek
        status = SQL
        if(status == "confirm"){
             Response.Write("OK");
        }
        */

        if (status == "success")
        { //Ödeme Onaylandı

            // BURADA YAPILMASI GEREKENLER ONAY İŞLEMLERİDİR.
            // 1) Veri tabanınızda ödemeyi onaylayın.
            // 2) Eğer müşterinize mesaj / SMS / e-posta gibi bilgilendirme yapacaksanız bu aşamada yapabilirsiniz. Bu işlemide yine iframe çağırma adımında merchant_oid bilgisini kayıt edip bu aşamada sorgulayarak verilere ulaşabilirsiniz.
            // 3) ['total_amount'] müşterinin yaptığı ödemenin toplam tutarıdır. Muhasebe işlemlerinizde bu tutarı kullanmanız gerekmektedir.
        }
        else
        { //Ödemeye Onay Verilmedi

            // BURADA YAPILMASI GEREKENLER
            // 1) Link API'de başarısız ödemeler için callback yapılmamaktadır.
            // 2) Dolayısıyla kod akışında buraya erişim olmayacaktır. Ancak ileride Link API'de yapılabilecek geliştirmeler
            // için dilerseniz buraya bir handler yazabilirsiniz.
            // ['failed_reason_msg'] - başarısız hata mesajı
        }
        // Bildirimin alındığını PayTR sistemine bildir. OK yanıtını bu alandan kaldırmayın.
        Response.Write("OK");
    }
}