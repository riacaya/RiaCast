using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RiaCastShell
{
    internal static class Program
    {
        internal const string AppUrl = "https://riacaya.github.io/RiaCast/";
        internal const string AppName = "RiaCast";
        /** Versi shell — dikirim ke halaman web untuk banner pembaruan/diagnostik. */
        internal const string ShellVersion = "1.0";
        internal const string StartupValueName = "RiaCast";
        private static string _logFile;

        internal const string ShowEventName = "Local\\RiaCastShell-Show";

        [STAThread]
        static void Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, "Local\\RiaCastShell-SingleInstance", out created))
            {
                if (!created)
                {
                    try
                    {
                        using (var showEvent = EventWaitHandle.OpenExisting(ShowEventName))
                        {
                            showEvent.Set();
                        }
                    }
                    catch { }
                    return;
                }

                string dataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "RiaCast");
                try { Directory.CreateDirectory(dataDir); } catch { }
                _logFile = Path.Combine(dataDir, "riacast-shell.log");
                Log("RiaCast Shell start " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));

                EventWaitHandle showHandle = null;
                try { showHandle = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName); } catch { }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                try
                {
                    Application.Run(new MainForm(showHandle));
                }
                catch (Exception ex)
                {
                    Log("Fatal: " + ex.ToString());
                    MessageBox.Show("RiaCast gagal dimulai:\n" + ex.Message, AppName,
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                finally
                {
                    try { if (showHandle != null) showHandle.Dispose(); } catch { }
                }
            }
        }

        internal static void Log(string s)
        {
            try
            {
                if (_logFile == null) return;
                try
                {
                    var fi = new FileInfo(_logFile);
                    if (fi.Exists && fi.Length > 1024 * 1024) fi.Delete();
                }
                catch { }
                File.AppendAllText(_logFile, DateTime.Now.ToString("HH:mm:ss") + "  " + s + "\r\n");
            }
            catch { }
        }

        internal static string AppDir
        {
            get
            {
                try { return Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? "."; }
                catch { return "."; }
            }
        }

        internal static string ExePath
        {
            get
            {
                try { return Assembly.GetExecutingAssembly().Location; }
                catch { return Application.ExecutablePath; }
            }
        }
    }

    internal class MainForm : Form
    {
        private WebView2 _web;
        private NotifyIcon _tray;
        private bool _allowExit;
        private ToolStripMenuItem _startupItem;
        private IncomingCallForm _incomingCallForm;
        private FormWindowState _restoreState = FormWindowState.Normal;
        private EventWaitHandle _showHandle;
        private Thread _showListener;

        internal MainForm() : this(null) { }

        internal MainForm(EventWaitHandle showHandle)
        {
            _showHandle = showHandle;
            Text = "RiaCast";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1100, 760);
            MinimumSize = new Size(420, 560);
            AutoScaleMode = AutoScaleMode.Font;
            try { Icon = LoadAppIcon(); } catch { }

            SetupTray();
            StartShowListener();
            Shown += async delegate(object s, EventArgs e) { await InitWebViewAsync(); };
            FormClosing += OnFormClosing;
            Resize += delegate(object s, EventArgs e) {
                if (WindowState == FormWindowState.Maximized) _restoreState = FormWindowState.Maximized;
                else if (WindowState == FormWindowState.Normal) _restoreState = FormWindowState.Normal;
                if (WindowState == FormWindowState.Minimized) HideToTray();
            };
        }

        private void StartShowListener()
        {
            if (_showHandle == null) return;
            _showListener = new Thread(delegate()
            {
                while (true)
                {
                    try
                    {
                        _showHandle.WaitOne();
                        if (IsDisposed || _allowExit) break;
                        try { BeginInvoke(new Action(delegate { ShowFromTray(); })); } catch { }
                    }
                    catch { break; }
                }
            });
            _showListener.IsBackground = true;
            _showListener.Start();
        }

        internal static Icon LoadAppIcon()
        {
            string png = Path.Combine(Program.AppDir, "assets", "logo-192.png");
            if (File.Exists(png))
            {
                try
                {
                    using (var bmp = new Bitmap(png))
                    {
                        IntPtr h = bmp.GetHicon();
                        Icon ico = Icon.FromHandle(h);
                        return (Icon)ico.Clone();
                    }
                }
                catch { }
            }
            return SystemIcons.Application;
        }

        private void SetupTray()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("Buka RiaCast", null, delegate(object s, EventArgs e) { ShowFromTray(); });
            _startupItem = new ToolStripMenuItem("Mulai saat Windows menyala", null, delegate(object s, EventArgs e) { ToggleStartup(); });
            _startupItem.Checked = IsStartupEnabled();
            menu.Items.Add(_startupItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Keluar", null, delegate(object s, EventArgs e) { ExitApp(); });

            _tray = new NotifyIcon();
            _tray.Text = "RiaCast";
            _tray.Icon = LoadAppIcon();
            _tray.Visible = true;
            _tray.ContextMenuStrip = menu;
            _tray.DoubleClick += delegate(object s, EventArgs e) { ShowFromTray(); };
            _tray.BalloonTipClicked += delegate(object s, EventArgs e) { ShowFromTray(); };
        }

        private async Task InitWebViewAsync()
        {
            try
            {
                string profile = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "RiaCast", "WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, profile, null);
                _web = new WebView2();
                _web.Dock = DockStyle.Fill;
                Controls.Add(_web);
                _web.BringToFront();
                await _web.EnsureCoreWebView2Async(env);
                _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                _web.CoreWebView2.Settings.IsWebMessageEnabled = true;
                _web.CoreWebView2.Settings.AreDevToolsEnabled = true;
                _web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true;
                _web.CoreWebView2.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs e)
                {
                    try { HandleWebMessage(e.TryGetWebMessageAsString()); } catch (Exception ex) { Program.Log("WebMessage error: " + ex.Message); }
                };
                _web.CoreWebView2.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs e)
                {
                    var uri = e.Uri ?? "";
                    if (uri.StartsWith("http://") || uri.StartsWith("https://"))
                    {
                        if (!uri.StartsWith(Program.AppUrl, StringComparison.OrdinalIgnoreCase))
                        {
                            e.Handled = true;
                            try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch { }
                            return;
                        }
                    }
                    e.Handled = true;
                    if (!string.IsNullOrEmpty(uri)) _web.CoreWebView2.Navigate(uri);
                };
                _web.CoreWebView2.PermissionRequested += delegate(object s, CoreWebView2PermissionRequestedEventArgs e)
                {
                    if (e.PermissionKind == CoreWebView2PermissionKind.Microphone ||
                        e.PermissionKind == CoreWebView2PermissionKind.Camera ||
                        e.PermissionKind == CoreWebView2PermissionKind.Notifications)
                    {
                        var u = e.Uri ?? "";
                        if (u.StartsWith("https://riacaya.github.io/", StringComparison.OrdinalIgnoreCase))
                            e.State = CoreWebView2PermissionState.Allow;
                    }
                };
                _web.Source = new Uri(Program.AppUrl);
                // Kirim versi shell ke halaman setelah navigasi selesai agar
                // banner pembaruan & panel diagnostik tahu versi native.
                _web.CoreWebView2.NavigationCompleted += delegate(object s, CoreWebView2NavigationCompletedEventArgs e)
                {
                    try
                    {
                        _web.CoreWebView2.PostWebMessageAsJson(
                            "{\"type\":\"shell-version\",\"version\":\"" + Program.ShellVersion + "\"}");
                    }
                    catch { }
                };
                Program.Log("WebView ready: " + Program.AppUrl);
            }
            catch (Exception ex)
            {
                Program.Log("WebView2 init failed: " + ex.Message);
                MessageBox.Show(this,
                    "Runtime Microsoft Edge WebView2 tidak tersedia.\n\nUnduh dan pasang:\nhttps://developer.microsoft.com/microsoft-edge/webview2/\n\nDetail: " + ex.Message,
                    Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                Close();
            }
        }

        private void HandleWebMessage(string json)
        {
            if (string.IsNullOrEmpty(json)) return;
            string type = JsonField(json, "type");
            if (type == "incoming-call")
            {
                string title = JsonField(json, "title");
                string body = JsonField(json, "body");
                string photo = JsonField(json, "photo");
                string name = JsonField(json, "name");
                if (string.IsNullOrEmpty(title)) title = "Panggilan masuk";
                if (string.IsNullOrEmpty(body)) body = "Ada panggilan masuk";
                Program.Log("Incoming call: " + title + " | " + body);
                BeginInvoke(new Action(delegate { ShowIncomingCallUi(title, body, photo, name); }));
                return;
            }
            if (type == "incoming-message")
            {
                string title = JsonField(json, "title");
                string body = JsonField(json, "body");
                if (string.IsNullOrEmpty(title)) title = "RiaCast";
                if (string.IsNullOrEmpty(body)) body = "Pesan baru";
                // Sama seperti panggilan: saat jendela utama terlihat, pesan
                // sudah tertangani in-app — jangan tampilkan notif sistem ganda.
                if (Visible && WindowState != FormWindowState.Minimized)
                {
                    Program.Log("Notify: jendela utama terlihat, balloon pesan dilewati");
                    return;
                }
                Program.Log("Notify: message | " + title + " | " + body);
                try { _tray.ShowBalloonTip(4000, title, body, ToolTipIcon.Info); } catch { }
                return;
            }
            if (type == "set-speaker")
            {
                string enabled = JsonField(json, "enabled");
                bool on = enabled == "true" || enabled == "1" || json.IndexOf("\"enabled\":true", StringComparison.OrdinalIgnoreCase) >= 0;
                Program.Log("Speaker: " + (on ? "on" : "off") + " (bridge diterima; routing audio desktop mengikuti perangkat default OS)");
            }
        }

        private void ShowIncomingCallUi(string title, string body, string photo, string name)
        {
            try
            {
                // Pesan "incoming-call" berasal dari web app yang sedang menerima
                // panggilan; saat jendela utama terlihat, panel dering in-app sudah
                // tampil — popup native hanya duplikat yang menutupi UI.
                if (Visible && WindowState != FormWindowState.Minimized)
                {
                    Program.Log("Incoming call: jendela utama terlihat, popup native dilewati (UI in-app aktif)");
                    return;
                }
                if (_incomingCallForm != null && !_incomingCallForm.IsDisposed)
                {
                    _incomingCallForm.UpdateInfo(title, body, photo, name);
                    _incomingCallForm.Activate();
                    return;
                }
                _incomingCallForm = new IncomingCallForm(title, body, photo, name,
                    delegate { OnCallAction("accept"); },
                    delegate { OnCallAction("reject"); });
                _incomingCallForm.FormClosed += delegate { _incomingCallForm = null; };
                _incomingCallForm.Show();
                _incomingCallForm.Activate();
            }
            catch (Exception ex) { Program.Log("IncomingCallUi error: " + ex.Message); }
        }

        private void OnCallAction(string action)
        {
            try
            {
                if (action == "accept") ShowFromTray();
                if (_web != null && _web.CoreWebView2 != null)
                {
                    string msg = "{\"type\":\"call-action\",\"action\":\"" + action + "\"}";
                    _web.CoreWebView2.PostWebMessageAsString(msg);
                }
            }
            catch (Exception ex) { Program.Log("Post call action failed: " + ex.Message); }
            try { if (_incomingCallForm != null && !_incomingCallForm.IsDisposed) _incomingCallForm.Close(); } catch { }
        }

        private static string JsonField(string json, string name)
        {
            try
            {
                var m = Regex.Match(json, "\"" + Regex.Escape(name) + "\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
                if (!m.Success) return "";
                string v = m.Groups[1].Value;
                v = Regex.Replace(v, "\\\\u([0-9a-fA-F]{4})", delegate(Match mm) {
                    try { return ((char)Convert.ToInt32(mm.Groups[1].Value, 16)).ToString(); } catch { return mm.Value; }
                });
                v = v.Replace("\\\"", "\"").Replace("\\\\", "\\").Replace("\\n", "\n").Replace("\\r", "\r").Replace("\\t", "\t");
                return v;
            }
            catch { return ""; }
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (_allowExit) return;
            e.Cancel = true;
            HideToTray();
            try { _tray.ShowBalloonTip(2500, "RiaCast", "RiaCast tetap berjalan di system tray untuk menerima notifikasi/panggilan.", ToolTipIcon.Info); } catch { }
        }

        private void HideToTray()
        {
            ShowInTaskbar = false;
            Hide();
        }

        private void ShowFromTray()
        {
            ShowInTaskbar = true;
            Show();
            WindowState = _restoreState == FormWindowState.Maximized ? FormWindowState.Maximized : FormWindowState.Normal;
            Activate();
        }

        private void ExitApp()
        {
            _allowExit = true;
            try { _tray.Visible = false; _tray.Dispose(); } catch { }
            try { if (_incomingCallForm != null && !_incomingCallForm.IsDisposed) _incomingCallForm.Close(); } catch { }
            try { if (_web != null) _web.Dispose(); } catch { }
            Application.Exit();
        }

        private static string RunKeyPath
        {
            get { return @"Software\Microsoft\Windows\CurrentVersion\Run"; }
        }

        private bool IsStartupEnabled()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, false))
                {
                    if (key == null) return false;
                    var val = key.GetValue(Program.StartupValueName) as string;
                    return !string.IsNullOrEmpty(val);
                }
            }
            catch { return false; }
        }

        private void ToggleStartup()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, true))
                {
                    if (key == null) return;
                    if (IsStartupEnabled())
                    {
                        key.DeleteValue(Program.StartupValueName, false);
                        if (_startupItem != null) _startupItem.Checked = false;
                        Program.Log("Startup disabled");
                    }
                    else
                    {
                        string cmd = "\"" + Program.ExePath + "\"";
                        key.SetValue(Program.StartupValueName, cmd);
                        if (_startupItem != null) _startupItem.Checked = true;
                        Program.Log("Startup enabled");
                    }
                }
            }
            catch (Exception ex)
            {
                Program.Log("Startup toggle failed: " + ex.Message);
                MessageBox.Show(this, "Gagal mengubah pengaturan startup:\n" + ex.Message, Program.AppName,
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }

    internal class IncomingCallForm : Form
    {
        private Label _titleLabel;
        private Label _bodyLabel;
        private PictureBox _avatarBox;
        private Action _onAccept;
        private Action _onReject;
        private volatile bool _ringing;
        private Thread _ringThread;

        internal IncomingCallForm(string title, string body, string photo, string name, Action onAccept, Action onReject)
        {
            _onAccept = onAccept;
            _onReject = onReject;
            Text = "RiaCast - Panggilan Masuk";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            ShowInTaskbar = true;
            ClientSize = new Size(355, 120);
            try { Icon = MainForm.LoadAppIcon(); } catch { }
            Load += delegate(object s, EventArgs e)
            {
                try
                {
                    var wa = Screen.FromHandle(Handle).WorkingArea;
                    Location = new Point(wa.Right - Width - 16, wa.Bottom - Height - 16);
                }
                catch { }
                StartRingtone();
            };
            FormClosed += delegate(object s, FormClosedEventArgs e) { StopRingtone(); };

            // 2 kolom: kiri foto profil (sempit), kanan info+aksi (lebar).
            var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = new Padding(0), Padding = new Padding(10, 12, 8, 12) };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 94));
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));

            var avatarHost = new Panel { Dock = DockStyle.Fill, Margin = new Padding(0) };
            _avatarBox = new PictureBox { Width = 92, Height = 92, SizeMode = PictureBoxSizeMode.Zoom, Anchor = AnchorStyles.Top };
            avatarHost.Resize += delegate { _avatarBox.Location = new Point(Math.Max(0, (avatarHost.ClientSize.Width - _avatarBox.Width) / 2), 0); };
            avatarHost.Controls.Add(_avatarBox);
            SetAvatar(photo, name ?? body ?? "");

            var right = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Margin = new Padding(0) };
            right.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            right.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
            right.RowStyles.Add(new RowStyle(SizeType.Absolute, 64));

            _titleLabel = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.TopCenter,
                AutoSize = false,
                Margin = new Padding(0),
                Font = new Font(SystemFonts.DefaultFont.FontFamily, 11.5f, FontStyle.Bold),
                Text = title ?? "Panggilan masuk",
            };
            _bodyLabel = new Label { Visible = false, Text = body ?? "" };

            var buttons = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = new Padding(0) };
            buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            var acceptBtn = MakeCallIconButton(true, 44);
            var rejectBtn = MakeCallIconButton(false, 44);
            acceptBtn.Margin = new Padding(0);
            rejectBtn.Margin = new Padding(0);
            acceptBtn.Click += delegate { try { if (_onAccept != null) _onAccept(); } catch { } };
            rejectBtn.Click += delegate { try { if (_onReject != null) _onReject(); } catch { } };

            Func<Button, string, Control> wrap = delegate(Button btn, string text)
            {
                var wrapPanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Margin = new Padding(0) };
                wrapPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
                wrapPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
                wrapPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
                btn.Anchor = AnchorStyles.None;
                btn.Margin = new Padding(0);
                var lbl = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.TopCenter, Text = text, AutoSize = false, Margin = new Padding(0), Font = new Font(SystemFonts.DefaultFont.FontFamily, 8f, FontStyle.Regular) };
                wrapPanel.Controls.Add(btn, 0, 0);
                wrapPanel.Controls.Add(lbl, 0, 1);
                return wrapPanel;
            };
            buttons.Controls.Add(wrap(acceptBtn, "Terima"), 0, 0);
            buttons.Controls.Add(wrap(rejectBtn, "Tolak"), 1, 0);

            right.Controls.Add(_titleLabel, 0, 0);
            right.Controls.Add(buttons, 0, 1);
            root.Controls.Add(avatarHost, 0, 0);
            root.Controls.Add(right, 1, 0);
            Controls.Add(root);
        }

        internal void UpdateInfo(string title, string body, string photo, string name)
        {
            if (_titleLabel != null) _titleLabel.Text = title ?? "Panggilan masuk";
            if (_bodyLabel != null) _bodyLabel.Text = body ?? "";
            SetAvatar(photo, name ?? body ?? "");
        }

        private void SetAvatar(string photo, string name)
        {
            try
            {
                var img = CreateAvatarBitmap(photo, name, 56);
                var old = _avatarBox.Image;
                _avatarBox.Image = img;
                if (old != null) old.Dispose();
            }
            catch { }
        }

        private static Bitmap CreateAvatarBitmap(string photo, string name, int size)
        {
            Bitmap src = null;
            try
            {
                var raw = (photo ?? "").Trim();
                if (!string.IsNullOrEmpty(raw))
                {
                    byte[] bytes = null;
                    if (raw.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || raw.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    {
                        try
                        {
                            var req = (HttpWebRequest)WebRequest.Create(raw);
                            req.Timeout = 3000;
                            req.ReadWriteTimeout = 3000;
                            using (var resp = req.GetResponse())
                            using (var rs = resp.GetResponseStream())
                            using (var ms2 = new MemoryStream())
                            { rs.CopyTo(ms2); bytes = ms2.ToArray(); }
                        }
                        catch { bytes = null; }
                    }
                    else
                    {
                        var b64 = raw;
                        var idx = raw.IndexOf("base64,", StringComparison.OrdinalIgnoreCase);
                        if (idx >= 0) b64 = raw.Substring(idx + 7);
                        bytes = Convert.FromBase64String(b64);
                    }
                    if (bytes != null && bytes.Length > 0)
                        using (var ms = new MemoryStream(bytes)) { src = new Bitmap(ms); }
                }
            }
            catch { src = null; }

            var bmp = new Bitmap(size, size);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                using (var path = new GraphicsPath())
                {
                    path.AddEllipse(0, 0, size - 1, size - 1);
                    g.SetClip(path);
                    if (src != null)
                    {
                        g.DrawImage(src, 0, 0, size, size);
                    }
                    else
                    {
                        var display = (name ?? "").Trim();
                        var fromIdx = display.IndexOf(" dari ", StringComparison.OrdinalIgnoreCase);
                        if (fromIdx >= 0) display = display.Substring(fromIdx + 6).Trim();
                        if (string.IsNullOrEmpty(display)) display = "?";
                        var colors = new[] { Color.FromArgb(30,136,229), Color.FromArgb(67,160,71), Color.FromArgb(142,36,170), Color.FromArgb(229,57,53), Color.FromArgb(251,140,0), Color.FromArgb(0,137,123) };
                        var bg = colors[Math.Abs(display.GetHashCode()) % colors.Length];
                        g.Clear(bg);
                        var initials = "?";
                        var parts = display.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 2)
                        {
                            var a = System.Text.RegularExpressions.Regex.Replace(parts[0], "[^A-Za-z\\p{L}0-9]", "");
                            var b = System.Text.RegularExpressions.Regex.Replace(parts[1], "[^A-Za-z\\p{L}0-9]", "");
                            initials = ((a.Length > 0 ? a.Substring(0,1) : parts[0].Substring(0,1)) + (b.Length > 0 ? b.Substring(0,1) : parts[1].Substring(0,1))).ToUpperInvariant();
                        }
                        else if (parts.Length == 1 && parts[0].Length > 0)
                        {
                            var p0 = parts[0];
                            var letters = System.Text.RegularExpressions.Regex.Replace(p0, "[^A-Za-z\\p{L}]", "");
                            initials = letters.Length > 0 ? letters.Substring(0,1).ToUpperInvariant() : "?";
                        }
                        using (var brush = new SolidBrush(Color.White))
                        using (var font = new Font(SystemFonts.DefaultFont.FontFamily, initials.Length > 1 ? 16f : 20f, FontStyle.Bold))
                        {
                            var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                            g.DrawString(initials, font, brush, new RectangleF(0, 0, size, size), sf);
                        }
                    }
                    g.ResetClip();
                }
                using (var pen = new Pen(Color.FromArgb(40, 0, 0, 0), 1)) g.DrawEllipse(pen, 0, 0, size - 1, size - 1);
            }
            if (src != null) src.Dispose();
            return bmp;
        }

        private static Button MakeCallIconButton(bool accept, int size)
        {
            var btn = new Button
            {
                Size = new Size(size, size),
                Anchor = AnchorStyles.None,
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.Transparent,
                Margin = new Padding(0),
                TabStop = false,
            };
            btn.FlatAppearance.BorderSize = 0;
            btn.FlatAppearance.MouseOverBackColor = Color.Transparent;
            btn.FlatAppearance.MouseDownBackColor = Color.Transparent;
            btn.Image = CreateCallIconBitmap(accept, size);
            btn.ImageAlign = ContentAlignment.MiddleCenter;
            btn.Text = "";
            return btn;
        }

        private static Bitmap CreateCallIconBitmap(bool accept, int size)
        {
            var bmp = new Bitmap(size, size);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                Color bg = accept ? Color.FromArgb(32, 168, 90) : Color.FromArgb(217, 45, 63);
                using (var brush = new SolidBrush(bg))
                {
                    g.FillEllipse(brush, 0, 0, size - 1, size - 1);
                }
                using (var pen = new Pen(Color.White, Math.Max(2.2f, size * 0.085f)))
                {
                    pen.StartCap = System.Drawing.Drawing2D.LineCap.Round;
                    pen.EndCap = System.Drawing.Drawing2D.LineCap.Round;
                    pen.LineJoin = System.Drawing.Drawing2D.LineJoin.Round;
                    float cx = size / 2f, cy = size / 2f, s = size;
                    if (accept)
                    {
                        // Gagang telepon (terima)
                        var pts = new PointF[] {
                            new PointF(cx - 0.20f*s, cy - 0.08f*s),
                            new PointF(cx - 0.24f*s, cy - 0.02f*s),
                            new PointF(cx - 0.18f*s, cy + 0.10f*s),
                            new PointF(cx - 0.06f*s, cy + 0.16f*s),
                            new PointF(cx + 0.06f*s, cy + 0.16f*s),
                            new PointF(cx + 0.18f*s, cy + 0.10f*s),
                            new PointF(cx + 0.24f*s, cy - 0.02f*s),
                            new PointF(cx + 0.20f*s, cy - 0.08f*s),
                        };
                        g.DrawLines(pen, new PointF[] { pts[0], pts[1], pts[2], pts[3] });
                        g.DrawLines(pen, new PointF[] { pts[4], pts[5], pts[6], pts[7] });
                        g.DrawArc(pen, cx - 0.20f*s, cy - 0.18f*s, 0.40f*s, 0.30f*s, 20, 140);
                        using (var cap = new Pen(Color.White, Math.Max(2.8f, size * 0.11f)))
                        {
                            cap.StartCap = System.Drawing.Drawing2D.LineCap.Round;
                            cap.EndCap = System.Drawing.Drawing2D.LineCap.Round;
                            g.DrawLine(cap, cx - 0.22f*s, cy - 0.10f*s, cx - 0.14f*s, cy - 0.02f*s);
                            g.DrawLine(cap, cx + 0.14f*s, cy - 0.02f*s, cx + 0.22f*s, cy - 0.10f*s);
                        }
                    }
                    else
                    {
                        // Gagang telepon menghadap bawah (tolak/putus)
                        using (var cap = new Pen(Color.White, Math.Max(2.8f, size * 0.11f)))
                        {
                            cap.StartCap = System.Drawing.Drawing2D.LineCap.Round;
                            cap.EndCap = System.Drawing.Drawing2D.LineCap.Round;
                            g.DrawLine(cap, cx - 0.22f*s, cy + 0.02f*s, cx - 0.14f*s, cy - 0.06f*s);
                            g.DrawLine(cap, cx + 0.14f*s, cy - 0.06f*s, cx + 0.22f*s, cy + 0.02f*s);
                        }
                        g.DrawArc(pen, cx - 0.22f*s, cy - 0.04f*s, 0.44f*s, 0.28f*s, 200, 140);
                    }
                }
            }
            return bmp;
        }

        private void StartRingtone()
        {
            if (_ringing) return;
            _ringing = true;
            _ringThread = new Thread(delegate()
            {
                try
                {
                    while (_ringing)
                    {
                        // Pola dering sederhana
                        try { Console.Beep(880, 180); } catch { }
                        if (!_ringing) break;
                        Thread.Sleep(40);
                        try { Console.Beep(660, 180); } catch { }
                        if (!_ringing) break;
                        Thread.Sleep(500);
                    }
                }
                catch { }
            });
            _ringThread.IsBackground = true;
            try { _ringThread.Start(); } catch { _ringing = false; }
        }

        private void StopRingtone()
        {
            _ringing = false;
            try { if (_ringThread != null && _ringThread.IsAlive) _ringThread.Join(50); } catch { }
            _ringThread = null;
        }
    }
}
