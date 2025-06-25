using StreamJsonRpc;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using System.Diagnostics;

namespace WindowsAutomationDriver
{
    class Program
    {
        static async Task Main(string[] args)
        {
            var service = new WindowsAutomationService();

            using var stdin = Console.OpenStandardInput();
            using var stdout = Console.OpenStandardOutput();

            var jsonRpc = JsonRpc.Attach(stdout, stdin, service);
            await jsonRpc.Completion;
        }
    }
}
