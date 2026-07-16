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
    public class SmsController : Controller
    {
        public ActionResult Sms()
        {
            // ####################### DÜZENLEMESİ ZORUNLU ALANLAR #######################
            //
            // API Entegrasyon Bilgileri - Mağaza paneline giriş yaparak BİLGİ sayfasından alabilirsiniz.
            string merchant_id = "AAAAAA"; 
            string merchant_key = "XXXXXXXXXXXXXXXX";
            string merchant_salt = "XXXXXXXXXXXXXXXX";
            //

            // Gerekli Bilgiler
            string id = "XXXYYY";  // Link ID - create metodunda dönülen değerdir.
            string cell_phone = "05000000000"; // SMS gönderilecek numara. 05 ile başlamalı ve 11 hane olmalıdır.
            string debug_on = "1";    // Hataları ekrana basmak için kullanılır.

            // Token oluşturma fonksiyonu, değiştirilmeden kullanılmalıdır.
            string Birlestir = string.Concat(id, merchant_id,cell_phone, merchant_salt);
            HMACSHA256 hmac = new HMACSHA256(Encoding.UTF8.GetBytes(merchant_key));
            byte[] b = hmac.ComputeHash(Encoding.UTF8.GetBytes(Birlestir));
            string paytr_token = Convert.ToBase64String(b);

            // Gönderilecek veriler oluşturuluyor
            NameValueCollection data = new NameValueCollection();
            data["merchant_id"] = merchant_id;
            data["id"] = id;
            data["cell_phone"] = cell_phone;
            data["debug_on"] = debug_on;
            data["paytr_token"] = paytr_token;
            //

            using (WebClient client = new WebClient())
            {
                client.Headers.Add("Content-Type", "application/x-www-form-urlencoded");
                byte[] result = client.UploadValues("https://www.paytr.com/odeme/api/link/send-sms", "POST", data);
                string ResultAuthTicket = Encoding.UTF8.GetString(result);
                dynamic json = JValue.Parse(ResultAuthTicket);
                if (json.status == "error")
                {
                    Response.Write("PAYTR LINK SEND SMS API request timeout. Error:" + json.err_msg + "");
                }
                else
                {
                    Response.Write(json);
                    /* Başarılı yanıt içerik örneği
                    [status]  => success
                    */
                }
            }
            return View();
        }
    }
}