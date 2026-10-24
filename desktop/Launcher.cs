using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("Blueprints IDE")]
[assembly: AssemblyDescription("Portable Java Blueprint IDE launcher")]
[assembly: AssemblyCompany("Blueprints IDE")]
[assembly: AssemblyProduct("Blueprints IDE")]
[assembly: AssemblyVersion("4.3.0.0")]
[assembly: AssemblyFileVersion("4.3.0.0")]

namespace BlueprintsLauncher
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (Environment.Is64BitOperatingSystem == false)
            {
                MessageBox.Show("Blueprints IDE требует Windows 10/11 x64.", "Blueprints IDE", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            Application.Run(new LaunchWindow(args));
        }
    }

    internal sealed class LaunchWindow : Form
    {
        private readonly Label title;
        private readonly Label detail;
        private readonly ProgressBar progress;
        private readonly CancellationTokenSource cancellation;
        private readonly string[] arguments;
        private bool finished;

        internal LaunchWindow(string[] args)
        {
            arguments = args;
            cancellation = new CancellationTokenSource();
            Text = "Blueprints IDE";
            ClientSize = new Size(470, 175);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(248, 250, 253);
            Font = new Font("Segoe UI", 10);
            title = new Label { Text = "Открываем Blueprints IDE", Left = 26, Top = 24, Width = 420, Height = 30, Font = new Font("Segoe UI", 15), ForeColor = Color.FromArgb(37, 49, 74) };
            detail = new Label { Text = "Первый запуск: распаковываем IDE и Java runtime…", Left = 28, Top = 65, Width = 410, Height = 36, ForeColor = Color.FromArgb(105, 121, 147), Font = new Font("Segoe UI", 9) };
            progress = new ProgressBar { Left = 28, Top = 121, Width = 412, Height = 8, Minimum = 0, Maximum = 100 };
            Controls.Add(title);
            Controls.Add(detail);
            Controls.Add(progress);
            Shown += async delegate { await StartAsync(); };
            FormClosing += delegate(object sender, FormClosingEventArgs eventArgs)
            {
                if (!finished)
                {
                    cancellation.Cancel();
                    detail.Text = "Отменяем подготовку…";
                    eventArgs.Cancel = true;
                }
            };
        }

        private void UpdateProgress(int percent, string message)
        {
            if (IsDisposed || !IsHandleCreated) return;
            BeginInvoke((Action)delegate
            {
                progress.Value = Math.Max(0, Math.Min(100, percent));
                detail.Text = message;
            });
        }

        private async Task StartAsync()
        {
            try
            {
                string directory = await Task.Run(() => Prepare(cancellation.Token));
                cancellation.Token.ThrowIfCancellationRequested();
                string executable = Path.Combine(directory, "BlueprintsIDE.exe");
                if (!File.Exists(executable)) throw new IOException("Не найден исполняемый файл IDE.");
                bool smoke = Array.IndexOf(arguments, "--smoke-test") >= 0;
                bool scenario = smoke && Array.IndexOf(arguments, "--smoke-scenario") >= 0;
                Process process = Process.Start(new ProcessStartInfo
                {
                    FileName = executable,
                    WorkingDirectory = directory,
                    Arguments = scenario ? "--smoke-test --smoke-scenario" : smoke ? "--smoke-test" : "",
                    UseShellExecute = false,
                    CreateNoWindow = smoke
                });
                if (smoke && process != null)
                {
                    await Task.Run(() => process.WaitForExit());
                    Environment.ExitCode = process.ExitCode;
                }
                finished = true;
                Close();
            }
            catch (OperationCanceledException)
            {
                finished = true;
                Close();
            }
            catch (Exception error)
            {
                finished = true;
                MessageBox.Show(this, "Не удалось открыть IDE.\n\n" + error.Message + "\n\nТакже можно распаковать ZIP-версию и открыть BlueprintsIDE.exe из неё.", "Blueprints IDE", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Environment.ExitCode = 1;
                Close();
            }
        }

        private string Prepare(CancellationToken token)
        {
            string baseDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BlueprintsIDE", "portable");
            Directory.CreateDirectory(baseDirectory);
            using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("BlueprintsPayload"))
            {
                if (payload == null) throw new IOException("В EXE отсутствует комплект IDE.");
                string hash;
                using (SHA256 algorithm = SHA256.Create())
                {
                    hash = BitConverter.ToString(algorithm.ComputeHash(payload)).Replace("-", "").ToLowerInvariant();
                }
                payload.Position = 0;
                string destination = Path.Combine(baseDirectory, "4.3.0-" + hash.Substring(0, 16));
                string marker = Path.Combine(destination, ".ready");
                using (Mutex installLock = new Mutex(false, "Local\\BlueprintsIDE-" + hash.Substring(0, 24)))
                {
                    bool held = false;
                    try
                    {
                        while (!held)
                        {
                            token.ThrowIfCancellationRequested();
                            try { held = installLock.WaitOne(300); }
                            catch (AbandonedMutexException) { held = true; }
                            if (!held) UpdateProgress(0, "Ожидаем завершения другого запуска IDE…");
                        }
                        if (File.Exists(marker) && File.ReadAllText(marker) == hash && File.Exists(Path.Combine(destination, "BlueprintsIDE.exe"))) return destination;
                        string staging = Path.Combine(baseDirectory, ".extract-" + Guid.NewGuid().ToString("N"));
                        Directory.CreateDirectory(staging);
                        try
                        {
                            using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read, true))
                            {
                                long total = 0;
                                foreach (ZipArchiveEntry entry in archive.Entries) total += entry.Length;
                                if (total > 2L * 1024 * 1024 * 1024) throw new IOException("Некорректный размер комплекта.");
                                long written = 0;
                                byte[] buffer = new byte[1024 * 128];
                                foreach (ZipArchiveEntry entry in archive.Entries)
                                {
                                    token.ThrowIfCancellationRequested();
                                    string target = Path.GetFullPath(Path.Combine(staging, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                                    EnsureChild(staging, target);
                                    if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                                    using (Stream input = entry.Open())
                                    using (FileStream output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                                    {
                                        int length;
                                        while ((length = input.Read(buffer, 0, buffer.Length)) > 0)
                                        {
                                            token.ThrowIfCancellationRequested();
                                            output.Write(buffer, 0, length);
                                            written += length;
                                        }
                                    }
                                    UpdateProgress(total == 0 ? 0 : (int)(written * 100 / total), "Готовим IDE и Java · " + (written / 1024 / 1024) + " / " + (total / 1024 / 1024) + " МиБ");
                                }
                            }
                            token.ThrowIfCancellationRequested();
                            File.WriteAllText(Path.Combine(staging, ".ready"), hash);
                            if (Directory.Exists(destination))
                            {
                                // A cache with no completion marker can only be our interrupted extraction.
                                EnsureChild(baseDirectory, destination);
                                Directory.Move(destination, destination + ".incomplete-" + Guid.NewGuid().ToString("N"));
                            }
                            Directory.Move(staging, destination);
                        }
                        finally
                        {
                            if (Directory.Exists(staging))
                            {
                                EnsureChild(baseDirectory, staging);
                                try { Directory.Delete(staging, true); } catch (IOException) { }
                            }
                        }
                    }
                    finally { if (held) installLock.ReleaseMutex(); }
                }
                return destination;
            }
        }

        private static void EnsureChild(string root, string child)
        {
            string prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string absolute = Path.GetFullPath(child);
            if (!absolute.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new IOException("Недопустимый путь в комплекте IDE.");
        }
    }
}
