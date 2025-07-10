using System.Diagnostics;
using System.Windows.Automation;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Newtonsoft.Json;

namespace WindowsAutomationDriver
{
    public class WindowsAutomationService
    {
        private readonly Cache<AutomationElement> _elementCache = new();

        public List<WindowInfo> GetProcessWindows(int processId)
        {
            var process = Process.GetProcessById(processId);
            var windows = ProcessWindow.GetAllFromProcess(process);

            var windowInfos = new List<WindowInfo>();

            foreach (var window in windows)
            {
                try
                {
                    var elem = AutomationElement.FromHandle(window.Handle);
                    //var elems = elem?.FindAll(TreeScope.Descendants, Condition.TrueCondition);

                    windowInfos.Add(new WindowInfo
                    {
                        ProcessId = process.Id,
                        ProcessName = process.ProcessName,
                        Title = window.Title,
                        Handle = window.Handle.ToInt32(),
                        ElementCount = 0//elems?.Count ?? 0
                    });
                }
                catch (Exception)
                {
                    // If automation element fails, still include the window but with 0 elements
                    windowInfos.Add(new WindowInfo
                    {
                        ProcessId = process.Id,
                        ProcessName = process.ProcessName,
                        Title = window.Title,
                        Handle = window.Handle.ToInt32(),
                        ElementCount = 0
                    });
                }
            }

            return windowInfos;
        }

        public ProcessTreeInfo GetProcessTreeWindows(int rootProcessId)
        {
            var rootProcess = Process.GetProcessById(rootProcessId);
            var processTree = ProcessTree.CreateFrom(rootProcess);

            return BuildProcessTreeInfo(processTree);
        }

        public List<ProcessTreeInfo> GetProcessTreeByExePath(string? executablePath = null, string? executableName = null)
        {
            var processTrees = new List<ProcessTreeInfo>();
            var trees = ProcessTree.GetProcessTrees(p =>
                //(executablePath == null || p.ExecPath.Equals(executablePath, StringComparison.OrdinalIgnoreCase)) &&
                executableName == null || p.ExecName.Equals(executableName, StringComparison.OrdinalIgnoreCase)
            );
            foreach (var tree in trees)
            {
                var processInfo = BuildProcessTreeInfo(tree);
                processTrees.Add(processInfo);
            }
            return processTrees;
        }

        private ProcessTreeInfo BuildProcessTreeInfo(ProcessTree processWithChildren)
        {
            var processInfo = new ProcessTreeInfo
            {
                ProcessId = processWithChildren.Process.Id,
                ProcessName = processWithChildren.Process.ProcessName,
                Windows = [],
                Children = []
            };

            // Get windows for this process
            try
            {
                var windows = ProcessWindow.GetAllFromProcess(processWithChildren.Process);

                foreach (var window in windows)
                {
                    try
                    {
                        var elem = AutomationElement.FromHandle(window.Handle);
                        var elems = elem?.FindAll(TreeScope.Descendants, Condition.TrueCondition);

                        processInfo.Windows.Add(new WindowInfo
                        {
                            ProcessId = processWithChildren.Process.Id,
                            ProcessName = processWithChildren.Process.ProcessName,
                            Title = window.Title,
                            Handle = window.Handle.ToInt32(),
                            ElementCount = elems?.Count ?? 0
                        });
                    }
                    catch (Exception)
                    {
                        // If automation element fails, still include the window but with 0 elements
                        processInfo.Windows.Add(new WindowInfo
                        {
                            ProcessId = processWithChildren.Process.Id,
                            ProcessName = processWithChildren.Process.ProcessName,
                            Title = window.Title,
                            Handle = window.Handle.ToInt32(),
                            ElementCount = 0
                        });
                    }
                }
            }
            catch (Exception)
            {
                // If getting windows fails, continue with empty windows list
            }

            // Recursively process children
            foreach (var child in processWithChildren.Children)
            {
                processInfo.Children.Add(BuildProcessTreeInfo(child));
            }

            return processInfo;
        }

        public string GetVersion() => "WindowsAutomationDriver v1.0.0";

        public int GetProcessId() => Process.GetCurrentProcess().Id;

        public UiTreeNode GetUiTree()
        {
            Console.Error.WriteLine("Building UI tree...");
            var rootElement = AutomationElement.RootElement;
            return BuildUiTreeNode(rootElement, "");
        }

        public UiTreeNode GetUiTreeForProcess(int processId, bool includeChildProcesses = false)
        {
            var process = Process.GetProcessById(processId);

            if (includeChildProcesses)
            {
                // Build a tree that includes child processes
                var processTree = ProcessTree.CreateFrom(process);
                return BuildUiTreeNodeFromProcessTree(processTree);
            }
            else
            {
                // Build UI tree for just the specified process
                return CreateProcessUiNode(process);
            }
        }

        private UiTreeNode BuildUiTreeNodeFromProcessTree(ProcessTree processTree)
        {
            var processNode = CreateProcessUiNode(processTree.Process);

            // Add child processes recursively
            foreach (var childProcess in processTree.Children)
            {
                var childNode = BuildUiTreeNodeFromProcessTree(childProcess);
                processNode.Children.Add(childNode);
            }

            return processNode;
        }

        private UiTreeNode CreateProcessUiNode(Process process)
        {
            var windows = ProcessWindow.GetAllFromProcess(process);

            var processNode = new UiTreeNode
            {
                Id = $"process_{process.Id}",
                Type = "Process",
                Text = process.ProcessName,
                Children = new List<UiTreeNode>(),
                Props = new Dictionary<string, object>
                {
                    ["ProcessId"] = process.Id,
                    ["ProcessName"] = process.ProcessName
                }
            };

            // Add windows for this process
            foreach (var window in windows)
            {
                var windowNode = CreateWindowUiNode(window);
                processNode.Children.Add(windowNode);
            }

            return processNode;
        }

        private UiTreeNode CreateWindowUiNode(ProcessWindow window)
        {
            try
            {
                var elem = AutomationElement.FromHandle(window.Handle);
                if (elem != null)
                {
                    return BuildUiTreeNode(elem, $"window_{window.Handle}");
                }
            }
            catch (Exception)
            {
                // If automation element fails, create a basic window node
            }

            // Create basic window node when automation fails
            return new UiTreeNode
            {
                Id = $"window_{window.Handle}",
                Type = "Window",
                Text = window.Title,
                Children = new List<UiTreeNode>(),
                Props = new Dictionary<string, object>
                {
                    ["Handle"] = window.Handle.ToInt64(),
                    ["Title"] = window.Title
                }
            };
        }

        public void ClickElement(string elementId)
        {
            try
            {
                var element = FindElementById(elementId);
                if (element != null)
                {
                    // Try to invoke the element first
                    if (element.TryGetCurrentPattern(InvokePattern.Pattern, out object invokePattern))
                    {
                        ((InvokePattern)invokePattern).Invoke();
                    }
                    else
                    {
                        // Fallback to mouse click
                        var clickablePoint = element.GetClickablePoint();
                        ClickAt((int)clickablePoint.X, (int)clickablePoint.Y);
                    }
                }
                else
                {
                    throw new ArgumentException($"Element with ID '{elementId}' not found.");
                }
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Error clicking element '{elementId}': {ex.Message}");
            }
        }

        public void RevealElement(string elementId)
        {
            var element = FindElementById(elementId);
            if (element != null)
            {
                if (element.TryGetCurrentPattern(ScrollItemPattern.Pattern, out object scrollPattern))
                {
                    ((ScrollItemPattern)scrollPattern).ScrollIntoView();
                }
                else
                {
                    // Try to bring the element into view
                    element.SetFocus();
                }
            }
            else
            {
                throw new ArgumentException($"Element with ID '{elementId}' not found.");
            }
        }

        public string TakeScreenshot(ScreenshotRect? rect = null)
        {
            Rectangle bounds;
            if (rect != null)
            {
                bounds = new Rectangle(rect.X, rect.Y, rect.Width, rect.Height);
            }
            else
            {
                bounds = Screen.PrimaryScreen?.Bounds ?? new Rectangle(0, 0, 1920, 1080);
            }

            using var bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
            using var graphics = Graphics.FromImage(bitmap);
            graphics.CopyFromScreen(bounds.X, bounds.Y, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);

            using var stream = new System.IO.MemoryStream();
            bitmap.Save(stream, ImageFormat.Png);
            return Convert.ToBase64String(stream.ToArray());
        }

        private UiTreeNode BuildUiTreeNode(AutomationElement element, string idPrefix)
        {
            var automationId = element.Current.AutomationId;
            var name = element.Current.Name;
            var className = element.Current.ClassName;
            var controlType = element.Current.ControlType.LocalizedControlType;

            var id = string.IsNullOrEmpty(automationId)
                ? $"{idPrefix}_{element.GetHashCode()}"
                : $"{idPrefix}_{automationId}";

            // Cache the element for later retrieval
            _elementCache.Set(id, element);

            var node = new UiTreeNode
            {
                Id = id,
                Type = controlType,
                Text = name,
                Children = new List<UiTreeNode>(),
                Props = new Dictionary<string, object>
                {
                    ["AutomationId"] = automationId ?? "",
                    ["ClassName"] = className ?? "",
                    ["ControlType"] = controlType,
                    ["IsEnabled"] = element.Current.IsEnabled,
                    ["IsOffscreen"] = element.Current.IsOffscreen
                }
            };

            // Add bounding rectangle if available

            var boundingRect = element.Current.BoundingRectangle;
            if (!boundingRect.IsEmpty)
            {
                node.Rect = new UiRect
                {
                    X = (int)boundingRect.X,
                    Y = (int)boundingRect.Y,
                    Width = (int)boundingRect.Width,
                    Height = (int)boundingRect.Height
                };
            }

            // Recursively build children (limit depth to avoid infinite recursion)

            var children = element.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement child in children)
            {
                var childNode = BuildUiTreeNode(child, idPrefix);
                node.Children.Add(childNode);
            }


            return node;
        }

        private AutomationElement? FindElementById(string elementId)
        {
            // First check the cache
            var cachedElement = _elementCache.Get(elementId);
            if (cachedElement != null)
            {
                try
                {
                    // Verify the element is still valid by accessing a property
                    var _ = cachedElement.Current.Name;
                    return cachedElement;
                }
                catch (Exception)
                {
                    // Element is stale, remove from cache and continue with fresh search
                }
            }

            // If not in cache or cache entry is stale, search for the element

            var rootElement = AutomationElement.RootElement;
            var foundElement = FindElementByIdRecursive(rootElement, elementId);

            // Cache the found element
            if (foundElement != null)
            {
                _elementCache.Set(elementId, foundElement);
            }

            return foundElement;

        }

        private AutomationElement? FindElementByIdRecursive(AutomationElement element, string targetId)
        {
            var automationId = element.Current.AutomationId;
            var currentId = string.IsNullOrEmpty(automationId)
                ? $"_{element.GetHashCode()}"
                : $"_{automationId}";

            // Cache this element while we're visiting it
            var fullCurrentId = $"_{element.GetHashCode()}";
            if (!string.IsNullOrEmpty(automationId))
            {
                fullCurrentId = $"_{automationId}";
            }
            _elementCache.Set(fullCurrentId, element);

            if (targetId.EndsWith(currentId))
            {
                return element;
            }

            var children = element.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement child in children)
            {
                var result = FindElementByIdRecursive(child, targetId);
                if (result != null)
                {
                    return result;
                }
            }


            return null;
        }

        public void SendKey(string key)
        {
            try
            {
                var keyCode = ConvertStringToKey(key);
                SendKeys.SendWait(keyCode);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Error sending key '{key}': {ex.Message}");
            }
        }

        public void SendText(string text)
        {
            try
            {
                // Escape special characters for SendKeys
                var escapedText = text.Replace("+", "{+}")
                                     .Replace("^", "{^}")
                                     .Replace("%", "{%}")
                                     .Replace("~", "{~}")
                                     .Replace("(", "{(}")
                                     .Replace(")", "{)}")
                                     .Replace("[", "{[}")
                                     .Replace("]", "{]}")
                                     .Replace("{", "{{}")
                                     .Replace("}", "{}}");

                SendKeys.SendWait(escapedText);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Error sending text '{text}': {ex.Message}");
            }
        }

        private string ConvertStringToKey(string key)
        {
            // Convert common key names to SendKeys format
            return key.ToUpper() switch
            {
                "F1" => "{F1}",
                "F2" => "{F2}",
                "F3" => "{F3}",
                "F4" => "{F4}",
                "F5" => "{F5}",
                "F6" => "{F6}",
                "F7" => "{F7}",
                "F8" => "{F8}",
                "F9" => "{F9}",
                "F10" => "{F10}",
                "F11" => "{F11}",
                "F12" => "{F12}",
                "ENTER" => "{ENTER}",
                "RETURN" => "{ENTER}",
                "TAB" => "{TAB}",
                "SPACE" => " ",
                "ESC" => "{ESC}",
                "ESCAPE" => "{ESC}",
                "BACKSPACE" => "{BACKSPACE}",
                "DELETE" => "{DELETE}",
                "HOME" => "{HOME}",
                "END" => "{END}",
                "PAGEUP" => "{PGUP}",
                "PAGEDOWN" => "{PGDN}",
                "UP" => "{UP}",
                "DOWN" => "{DOWN}",
                "LEFT" => "{LEFT}",
                "RIGHT" => "{RIGHT}",
                "INSERT" => "{INSERT}",
                "CTRL+A" => "^a",
                "CTRL+C" => "^c",
                "CTRL+V" => "^v",
                "CTRL+X" => "^x",
                "CTRL+Z" => "^z",
                "CTRL+Y" => "^y",
                "CTRL+S" => "^s",
                "CTRL+O" => "^o",
                "CTRL+N" => "^n",
                "ALT+F4" => "%{F4}",
                _ => key.Length == 1 ? key : $"{{{key}}}"
            };
        }

        [DllImport("user32.dll", CharSet = CharSet.Auto, CallingConvention = CallingConvention.StdCall)]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);

        [DllImport("user32.dll")]
        static extern bool SetCursorPos(int X, int Y);

        private const int MOUSEEVENTF_LEFTDOWN = 0x02;
        private const int MOUSEEVENTF_LEFTUP = 0x04;

        private void ClickAt(int x, int y)
        {
            SetCursorPos(x, y);
            mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP, (uint)x, (uint)y, 0, 0);
        }
    }

    public class WindowInfo
    {
        [JsonProperty("processId")]
        public int ProcessId { get; set; }

        [JsonProperty("processName")]
        public string ProcessName { get; set; } = string.Empty;

        [JsonProperty("title")]
        public string Title { get; set; } = string.Empty;

        [JsonProperty("handle")]
        public int Handle { get; set; }

        [JsonProperty("elementCount")]
        public int ElementCount { get; set; }
    }

    public class ProcessTreeInfo
    {
        [JsonProperty("processId")]
        public int ProcessId { get; set; }

        [JsonProperty("processName")]
        public string ProcessName { get; set; } = string.Empty;

        [JsonProperty("windows")]
        public List<WindowInfo> Windows { get; set; } = new();

        [JsonProperty("children")]
        public List<ProcessTreeInfo> Children { get; set; } = new();
    }

    public class UiTreeNode
    {
        [JsonProperty("id")]
        public string Id { get; set; } = string.Empty;

        [JsonProperty("type")]
        public string Type { get; set; } = string.Empty;

        [JsonProperty("text")]
        public string Text { get; set; } = string.Empty;

        [JsonProperty("children")]
        public List<UiTreeNode> Children { get; set; } = new();

        [JsonProperty("rect")]
        public UiRect? Rect { get; set; }

        [JsonProperty("props")]
        public Dictionary<string, object> Props { get; set; } = new();
    }

    public class UiRect
    {
        [JsonProperty("x")]
        public int X { get; set; }

        [JsonProperty("y")]
        public int Y { get; set; }

        [JsonProperty("width")]
        public int Width { get; set; }

        [JsonProperty("height")]
        public int Height { get; set; }
    }

    public class ScreenshotRect
    {
        [JsonProperty("x")]
        public int X { get; set; }

        [JsonProperty("y")]
        public int Y { get; set; }

        [JsonProperty("width")]
        public int Width { get; set; }

        [JsonProperty("height")]
        public int Height { get; set; }
    }

    public class Cache<T>
    {
        private readonly Dictionary<string, CacheEntry<T>> _shortTermCache = new();
        private readonly Dictionary<string, CacheEntry<T>> _longTermCache = new();
        private readonly object _lock = new();
        private readonly System.Threading.Timer _cleanupTimer;

        private const int SHORT_TERM_MAX_SIZE = 100000;
        private const int LONG_TERM_MAX_SIZE = 1000;
        private readonly TimeSpan SHORT_TERM_EXPIRY = TimeSpan.FromMinutes(1);
        private readonly TimeSpan LONG_TERM_EXPIRY = TimeSpan.FromMinutes(10);

        public Cache()
        {
            // Run cleanup every 30 seconds
            _cleanupTimer = new System.Threading.Timer(Cleanup, null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));
        }

        public void Set(string key, T value)
        {
            lock (_lock)
            {
                var entry = new CacheEntry<T>(value, DateTime.UtcNow);

                // Add to short-term cache
                _shortTermCache[key] = entry;

                // Manage short-term cache size
                if (_shortTermCache.Count > SHORT_TERM_MAX_SIZE)
                {
                    // Remove oldest entries that are past expiry
                    var expiredKeys = _shortTermCache
                        .Where(kvp => DateTime.UtcNow - kvp.Value.Timestamp > SHORT_TERM_EXPIRY)
                        .Select(kvp => kvp.Key)
                        .ToList();

                    foreach (var expiredKey in expiredKeys)
                    {
                        _shortTermCache.Remove(expiredKey);
                    }

                    // If still over limit, remove oldest entries
                    if (_shortTermCache.Count > SHORT_TERM_MAX_SIZE)
                    {
                        var oldestKeys = _shortTermCache
                            .OrderBy(kvp => kvp.Value.Timestamp)
                            .Take(_shortTermCache.Count - SHORT_TERM_MAX_SIZE)
                            .Select(kvp => kvp.Key)
                            .ToList();

                        foreach (var oldestKey in oldestKeys)
                        {
                            _shortTermCache.Remove(oldestKey);
                        }
                    }
                }
            }
        }

        public T? Get(string key)
        {
            lock (_lock)
            {
                // Check short-term cache first
                if (_shortTermCache.TryGetValue(key, out var shortTermEntry))
                {
                    if (DateTime.UtcNow - shortTermEntry.Timestamp <= SHORT_TERM_EXPIRY)
                    {
                        return shortTermEntry.Value;
                    }
                    else
                    {
                        _shortTermCache.Remove(key);

                        // Move to long-term cache if not already there
                        if (!_longTermCache.ContainsKey(key))
                        {
                            _longTermCache[key] = shortTermEntry;

                            // Manage long-term cache size
                            if (_longTermCache.Count > LONG_TERM_MAX_SIZE)
                            {
                                var oldestKey = _longTermCache
                                    .OrderBy(kvp => kvp.Value.Timestamp)
                                    .First().Key;
                                _longTermCache.Remove(oldestKey);
                            }
                        }
                    }
                }

                // Check long-term cache
                if (_longTermCache.TryGetValue(key, out var longTermEntry))
                {
                    if (DateTime.UtcNow - longTermEntry.Timestamp <= LONG_TERM_EXPIRY)
                    {
                        return longTermEntry.Value;
                    }
                    else
                    {
                        _longTermCache.Remove(key);
                    }
                }

                return default(T);
            }
        }

        public bool Contains(string key)
        {
            lock (_lock)
            {
                if (_shortTermCache.TryGetValue(key, out var shortTermEntry))
                {
                    if (DateTime.UtcNow - shortTermEntry.Timestamp <= SHORT_TERM_EXPIRY)
                    {
                        return true;
                    }
                    else
                    {
                        _shortTermCache.Remove(key);
                    }
                }

                if (_longTermCache.TryGetValue(key, out var longTermEntry))
                {
                    if (DateTime.UtcNow - longTermEntry.Timestamp <= LONG_TERM_EXPIRY)
                    {
                        return true;
                    }
                    else
                    {
                        _longTermCache.Remove(key);
                    }
                }

                return false;
            }
        }

        private void Cleanup(object? state)
        {
            lock (_lock)
            {
                var now = DateTime.UtcNow;

                // Clean short-term cache
                var expiredShortTermKeys = _shortTermCache
                    .Where(kvp => now - kvp.Value.Timestamp > SHORT_TERM_EXPIRY)
                    .Select(kvp => kvp.Key)
                    .ToList();

                foreach (var key in expiredShortTermKeys)
                {
                    _shortTermCache.Remove(key);
                }

                // Clean long-term cache
                var expiredLongTermKeys = _longTermCache
                    .Where(kvp => now - kvp.Value.Timestamp > LONG_TERM_EXPIRY)
                    .Select(kvp => kvp.Key)
                    .ToList();

                foreach (var key in expiredLongTermKeys)
                {
                    _longTermCache.Remove(key);
                }
            }
        }

        public void Dispose()
        {
            _cleanupTimer?.Dispose();
        }
    }

    public class CacheEntry<T>
    {
        public T Value { get; }
        public DateTime Timestamp { get; }

        public CacheEntry(T value, DateTime timestamp)
        {
            Value = value;
            Timestamp = timestamp;
        }
    }
}
