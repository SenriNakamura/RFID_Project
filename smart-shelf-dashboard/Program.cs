/*
 * Smart Shelf — RFID Reader Client
 * EE-144 Group Project
 *
 * Replaces the original Program.cs from the C# Read Tag Sample.
 * After each Read() cycle, POSTs the list of detected EPCs to the Flask
 * backend at http://localhost:5000/api/scan. The backend handles
 * inventory tracking, threshold detection, and email alerts.
 *
 * Build target: .NET Framework 4.8
 * Required references:
 *   - MercuryAPI.dll  (from C:\EE-144\mercuryapi-1.37.5.49\cs)
 *   - System.Net.Http
 *   - System.Web.Extensions  (for JavaScriptSerializer)
 *
 * NOTE: If you'd rather use Newtonsoft.Json, install it from NuGet
 *       and replace JavaScriptSerializer with JsonConvert.
 */

using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using ThingMagic;

internal class Program
{
    // ----- Configuration -----
    private const string ReaderUri      = "tmr:///com4";        // change to your COM port
    private const int    ReadPower      = 2000;                 // 0.01 dBm units
    private const int    ReadDurationMs = 1000;                 // per scan window
    private const int    LoopIntervalMs = 5000;                 // wait between scans
    private const string BackendUrl     = "http://localhost:5000/api/scan";

    private static readonly HttpClient http = new HttpClient();

    private static void Main(string[] args)
    {
        Console.WriteLine("Smart Shelf RFID Reader Client");
        Console.WriteLine("================================");

        Reader r = null;
        try
        {
            r = Reader.Create(ReaderUri);
            r.Connect();
            r.ParamSet("/reader/region/id", Reader.Region.NA);
            r.ParamSet("/reader/radio/readPower", ReadPower);

            int[] antennaList = { 1 };
            SimpleReadPlan plan = new SimpleReadPlan(
                antennaList, TagProtocol.GEN2, null, null, ReadDurationMs);
            r.ParamSet("/reader/read/plan", plan);

            Console.WriteLine($"Reader connected: {ReaderUri}");
            Console.WriteLine($"Posting to:       {BackendUrl}");
            Console.WriteLine($"Scan interval:    {LoopIntervalMs} ms\n");

            // Continuous scan loop
            while (true)
            {
                ScanCycleAsync(r).Wait();
                Thread.Sleep(LoopIntervalMs);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Fatal error: {ex.Message}");
        }
        finally
        {
            if (r != null) r.Destroy();
        }
    }

    /// <summary>
    /// Run a single Read() cycle, collect unique EPCs, and POST them.
    /// </summary>
    private static async Task ScanCycleAsync(Reader r)
    {
        try
        {
            TagReadData[] tagReads = r.Read(ReadDurationMs);
            List<string> epcs = new List<string>();
            foreach (TagReadData tr in tagReads)
            {
                epcs.Add(tr.EpcString);
            }

            string ts = DateTime.Now.ToString("HH:mm:ss");
            Console.WriteLine($"[{ts}] Detected {epcs.Count} tag(s)");
            foreach (string epc in epcs)
            {
                Console.WriteLine($"     {epc}");
            }

            await PostToBackendAsync(epcs);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Scan cycle error: {ex.Message}");
        }
    }

    /// <summary>
    /// POST { "epcs": [...] } to the Flask backend.
    /// </summary>
    private static async Task PostToBackendAsync(List<string> epcs)
    {
        try
        {
            var payload = new Dictionary<string, object> { { "epcs", epcs } };
            string json = new JavaScriptSerializer().Serialize(payload);

            var content = new StringContent(json, Encoding.UTF8, "application/json");
            HttpResponseMessage resp = await http.PostAsync(BackendUrl, content);
            string body = await resp.Content.ReadAsStringAsync();

            if (resp.IsSuccessStatusCode)
            {
                Console.WriteLine($"     ✔ Backend ACK: {body}\n");
            }
            else
            {
                Console.WriteLine($"     ✘ Backend {(int)resp.StatusCode}: {body}\n");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"     ✘ POST failed: {ex.Message}\n");
        }
    }
}
