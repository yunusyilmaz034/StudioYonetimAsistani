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
    public class DeleteController : Controller
    {
        public ActionResult Delete()
        {
            // ####################### REQUIRED FIELDS TO BE REGULATED #######################
            //
            // API - Information Integration  - You can get them from the information page after logging into the PayTR Merchant Panel.
            string merchant_id      = "AAAAAA";
            string merchant_key     = "XXXXXXXXXXXXXXXX";
            string merchant_salt    = "XXXXXXXXXXXXXXXX";
            //

            // Required Values
            string id               = "YYYXXX";     // (Link ID) It is the value returned in the create method.
            string debug_on         = "1";          // Send as 1 to see integration and test errors

            // The token function should be used unchanged.
            string Birlestir = string.Concat(id,merchant_id, merchant_salt);
            HMACSHA256 hmac = new HMACSHA256(Encoding.UTF8.GetBytes(merchant_key));
            byte[] b = hmac.ComputeHash(Encoding.UTF8.GetBytes(Birlestir));
            string paytr_token = Convert.ToBase64String(b);

            // Creating data to be sent in that part
            NameValueCollection data = new NameValueCollection();

            data["merchant_id"] = merchant_id;
            data["id"] = id;
            data["debug_on"] = debug_on;
            data["paytr_token"] = paytr_token;
            //

            using (WebClient client = new WebClient())
            {
                client.Headers.Add("Content-Type", "application/x-www-form-urlencoded");
                byte[] result = client.UploadValues("https://www.paytr.com/odeme/api/link/delete", "POST", data);
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
                    */
                }
            }

            return View();
        }
    }
}