using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;
using System.Web.Mvc;
using System.Collections.Specialized;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Web.UI;
using System.Web.UI.WebControls;
using System.Web.Routing;
namespace WebApplication1.Controllers
{
    public class CreateController : Controller
    {
        public ActionResult List()
        {
            // ####################### DÜZENLEMESİ ZORUNLU ALANLAR #######################
            //
            // API Entegrasyon Bilgileri - Mağaza paneline giriş yaparak BİLGİ sayfasından alabilirsiniz.
            string merchant_id = "AAAAAA";
            string merchant_key = "XXXXXXXXXXXXXXXX";
            string merchant_salt = "XXXXXXXXXXXXXXXX";
            //

            //    ## Gerekli Bilgiler
            string name = "Örnek Ürün / Hizmet Adı";
            // Ürün / Hizmetin açıklaması. En az 4 en fazla 200 karakter.

            int price = 1445;
            // 14.45 TL için 14.45 * 100 = 1445 (100 ile çarpılmış ve integer olarak gönderilmelidir.)

            string max_installment = "12";
            // 2 - 12 arası gönderilebilir. 1 gönderilirse bireysel kartlar taksit yapılamaz.

            string currency = "TL";
            //TL - USD - EUR - GBP gönderilebilir.

            string link_type = "product";
            //collection (fatura/cari tahsilat) veya product (ürün/hizmet satışı) gönderilebilir.
            //collection ise email (ödeme yapan tarafın eposta adresi olmalı).
            //product ise min_count (satın alma adet alt limiti) gereklidir.

            string lang = "tr";
            //tr veya en gönderilebilir.

            ////////////////////////////////////////////////////////////////////////////////////////
            // Opsiyonel bilgiler, gönderilmesi zorunlu değildir.
            string expiry_date = "2020-11-23 17:00:00";
            // Link'in son kullanma tarihi. Gönderilmezse, sürekli açık kalır.
            // Örnek format: 2021-05-31 17:00:00

            string callback_id = "";
            // Bildirimde dönülecek bildirim ID'si. Alfanumerik ve en fazla 64 karakter olabilir.
            //callback_link gönderildiğinde bu alan zorunlu olmaktadır.

            string callback_link = "";
            //Link ile yapılan ödemenin sonucunun gönderileceği URL. En fazla 400 kararkter.
            //http:// ya da https:// ile başlamalı, localhost olmamalı ve port içermemelidir.
            //callback_id gönderildiğinde bu alan zorunlu olmaktadır.

            string max_count = "";
            //Yalnızca product modunda kullanılabilir.
            //Link'in stok adedini belirler. Gönderilmezse, stok limiti uygulanmaz.
            //Stok adedi kadar ödeme yapıldığında link pasif olur.

            string pft = "";
            //2 - 12 arası gönderilebilir. Gönderilen en yüksek sayıya kadar olan tüm taksit seçenekleri
            //Peşin Fiyatına Taksit olarak ayarlanır.
            //DİKKAT: Peşin Fiyatına Taksit olarak belirlediğiniz taksit sayıları için yapılan tüm
            //ödeme işlemlerinde, taksit komisyonları sizden kesilecektir.

            string debug_on = "1";
            //Entegrasyon hatalarını alabilmek için 1 olarak bırakın.
            ////////////////////////////////////////////////////////////////////////////////////////////
            ///

            string min_count = "";
            string email = "";
            if (link_type == "product")
            {
               min_count = "1";
               // Alt adet limiti.
            }
            else if (link_type == "collection")
            {
               email = "test@mail.com";
               // Ödeme yapan kullanıcının eposta adresi.
            }

            NameValueCollection data = new NameValueCollection();
            data["merchant_id"] = merchant_id;
            data["name"] = name;
            data["price"] = price.ToString();

            // Token oluşturma fonksiyonu, değiştirilmeden kullanılmalıdır.
            string Birlestir = string.Concat(name,price.ToString(),currency,max_installment,link_type,lang,min_count,merchant_salt);
            HMACSHA256 hmac = new HMACSHA256(Encoding.UTF8.GetBytes(merchant_key));
            byte[] b = hmac.ComputeHash(Encoding.UTF8.GetBytes(Birlestir));
            string paytr_token = Convert.ToBase64String(b);

            // Gönderilecek veriler oluşturuluyor
            data["currency"] = currency;
            data["max_installment"] = max_installment;
            data["link_type"] = link_type;
            data["lang"] = lang;
            data["min_count"] = min_count;
            data["email"] = email;
            data["expiry_date"] = expiry_date;
            data["max_count"] = max_count;
            data["pft"] = pft;
            data["callback_link"] = callback_link;
            data["callback_id"] = callback_id;
            data["debug_on"] = debug_on;
            data["paytr_token"] = paytr_token;
            //

            using (WebClient client = new WebClient())
            {
                client.Headers.Add("Content-Type", "application/x-www-form-urlencoded");
                byte[] result = client.UploadValues("https://www.paytr.com/odeme/api/link/create", "POST", data);
                string ResultAuthTicket = Encoding.UTF8.GetString(result);
                dynamic json = JValue.Parse(ResultAuthTicket);
                if (json.status == "error")
                {
                    Response.Write("PAYTR LINK CREATE API request timeout. Error:" + json.err_msg + "");
                }
                else
                {
                    Response.Write(json);
                   /* Başarılı yanıt içerik örneği

                     [status]  => success
                     [id]      => XXXXXX
                     [link]    => https://www.paytr.com/link/XXXXXX
                     */
                }
            }
            return View();
        }
    }
}