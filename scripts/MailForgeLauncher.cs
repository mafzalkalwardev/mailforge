using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace MailForgeLauncher
{
    internal static class Program
    {
        private static int Run(string fileName, string arguments, string workingDirectory)
        {
            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = false,
            };

            using (var process = Process.Start(psi))
            {
                if (process == null) return 1;
                process.OutputDataReceived += (_, e) => { if (e.Data != null) Console.WriteLine(e.Data); };
                process.ErrorDataReceived += (_, e) => { if (e.Data != null) Console.WriteLine(e.Data); };
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                return process.ExitCode;
            }
        }

        private static bool DockerRunning(string root)
        {
            return Run("docker", "info", root) == 0;
        }

        private static string MongoHealth(string root)
        {
            var psi = new ProcessStartInfo
            {
                FileName = "docker",
                Arguments = "inspect --format \"{{.State.Health.Status}}\" mailforge-mongo",
                WorkingDirectory = root,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true,
            };
            using (var p = Process.Start(psi))
            {
                if (p == null) return "";
                p.WaitForExit();
                return p.StandardOutput.ReadToEnd().Trim();
            }
        }

        public static int Main()
        {
            var root = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            if (root == null) return 1;
            Directory.SetCurrentDirectory(root);

            if (!File.Exists(Path.Combine(root, "package.json")))
            {
                Console.WriteLine("ERROR: Run MailForge.exe from the MailForge project folder.");
                Console.ReadLine();
                return 1;
            }

            if (!File.Exists(Path.Combine(root, ".env")) && File.Exists(Path.Combine(root, ".env.example")))
            {
                File.Copy(Path.Combine(root, ".env.example"), Path.Combine(root, ".env"));
                Console.WriteLine("Created .env from .env.example");
            }

            Console.WriteLine("MailForge launcher");
            Console.WriteLine("==================");

            if (DockerRunning(root))
            {
                Console.WriteLine("Starting local MongoDB (Docker)...");
                if (Run("docker", "compose -f docker-compose.mongo.yml up -d", root) != 0)
                {
                    Console.WriteLine("ERROR: Could not start MongoDB container.");
                    Console.ReadLine();
                    return 1;
                }

                var deadline = DateTime.UtcNow.AddSeconds(45);
                var health = "";
                while (DateTime.UtcNow < deadline)
                {
                    health = MongoHealth(root);
                    if (health == "healthy") break;
                    Thread.Sleep(2000);
                }

                if (health == "healthy")
                    Console.WriteLine("MongoDB ready at mongodb://127.0.0.1:27017/mailforge");
                else
                    Console.WriteLine("WARNING: MongoDB not healthy yet - app will retry.");
            }
            else
            {
                Console.WriteLine("WARNING: Docker Desktop is not running. Start it for persistent data.");
            }

            Console.WriteLine();
            Console.WriteLine("Starting MailForge at http://localhost:5000");
            Console.WriteLine("Close this window to stop the server.");
            Console.WriteLine();

            return Run("cmd.exe", "/c npm start", root);
        }
    }
}
