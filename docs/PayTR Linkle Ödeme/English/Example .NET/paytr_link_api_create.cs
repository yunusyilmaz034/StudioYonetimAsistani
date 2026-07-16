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
            // ####################### REQUIRED FIELDS TO BE REGULATED #######################
            //
            // API - Information Integration  - You can get them from the information page after logging into the PayTR Merchant Panel.
            string merchant_id      = "AAAAAA";
            string merchant_key     = "XXXXXXXXXXXXXXXX";
            string merchant_salt    = "XXXXXXXXXXXXXXXX";
            //

            // Required Values
            string name             = "Example Product Name";
            // Description of the product or service. ( minimum 4 and maximum 200 characters required)

            int price = 1445;
            // 14.45 * 100 = 1445 for 14.45 TL (multiplied by 100 and must be sent as integer.)

            string max_installment = "12";
            // It can be sent between 2 and 12. If 1 is sent, individual cards cannot be used for installments.

            string currency = "TL";
            //TL, EUR, USD, GBP, RUB (If the value is null, TL is accepted)

            string link_type = "product";
            //For product sale: product - For invoice / current collection: collection
            //If link_type is collection, the e-mail address of the customer who will make the payment must be sent.
            //If link_type is a product, min_count (minimum purchase count) is required.

            string lang = "tr";
            //tr or en can be sent.

            ////////////////////////////////////////////////////////////////////////////////////////
            // Optional values is not required to be sent.
            string expiry_date = "2020-11-23 17:00:00";
            // Link's expiration date. If not sent, it remains open until deleted.
            // Example format: 2021-05-31 

            string callback_id = "";
            // It can be alphanumeric and up to 64 characters.
            // Notification ID to return in notification. This field is required when the callback_link is sent.

            string callback_link = "";
            //The URL where the result of the link payment will be sent.
            //callback_link	Must start with http: // or https: //, not contain localhost and port.
            //This field is required when the callback_id is sent.

            string max_count = "";
            //Available only in product mode.
            //It determines the stock quantity of the link. If not submitted, the stock limit is not applied.
            //When the payment is made according to the stock, the link becomes inactive.

            string pft = "";
            //Installment Cash Price setting (optional).
            //All installment options up to the highest number sent are set as Installments to Cash Price.
            //ATTENTION: Installment commissions will be deducted from you in all payment
            //transactions made for the number of installments you have determined as Installments for Cash Price.

            string debug_on = "1";
            //Send as 1 for integration and test errors
            ////////////////////////////////////////////////////////////////////////////////////////////
            ///

            string min_count = "";
            string email = "";
            if (link_type == "product")
            {
               min_count = "1";
              // Lower count limit.
            }

            else if (link_type == "collection")
            {
               email = "test@mail.com";
                // the e-mail address of the customer who will make the payment 
            }

            NameValueCollection data = new NameValueCollection();

            data["merchant_id"] = merchant_id;
            data["name"] = name;
            data["price"] = price.ToString();

            // The token function should be used unchanged.
            string Birlestir = string.Concat(name,price.ToString(),currency,max_installment,link_type,lang,min_count,merchant_salt);
            HMACSHA256 hmac = new HMACSHA256(Encoding.UTF8.GetBytes(merchant_key));
            byte[] b = hmac.ComputeHash(Encoding.UTF8.GetBytes(Birlestir));
            string paytr_token = Convert.ToBase64String(b);

            // Creating data to be sent in that part
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
                    /* an successful response example
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