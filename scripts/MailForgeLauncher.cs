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

        private static void OpenBrowser()
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "http://localhost:5000",
                    UseShellExecute = true,
                });
            }
            catch
            {
                Console.WriteLine("Open http://localhost:5000 in your browser.");
            }
        }

        public static int Main()
        {
            var root = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            if (root == null) return 1;
            Directory.SetCurrentDirectory(root);

            if (!File.Exists(Path.Combine(root, "package.json")))
            {
                Console.WriteLine("ERROR: Run MailForge.exe from the MailForge app folder.");
                Console.ReadLine();
                return 1;
            }

            if (!File.Exists(Path.Combine(root, ".env")) && File.Exists(Path.Combine(root, ".env.example")))
            {
                File.Copy(Path.Combine(root, ".env.example"), Path.Combine(root, ".env"));
                Console.WriteLine("Created .env from .env.example");
            }

            Directory.CreateDirectory(Path.Combine(root, "data", "mongodb"));
            Directory.CreateDirectory(Path.Combine(root, "tools", "mongodb-binaries"));

            Console.WriteLine("MailForge launcher");
            Console.WriteLine("==================");
            Console.WriteLine("Using embedded portable MongoDB.");
            Console.WriteLine("Data folder: " + Path.Combine(root, "data", "mongodb"));
            Console.WriteLine();
            Console.WriteLine("Starting MailForge at http://localhost:5000");
            Console.WriteLine("Close this window to stop the server.");
            Console.WriteLine();

            new Thread(() =>
            {
                Thread.Sleep(2500);
                OpenBrowser();
            }).Start();

            return Run("cmd.exe", "/c npm start", root);
        }
    }
}
