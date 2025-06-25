using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace WindowsAutomationDriver
{
    class Test { }

    public class ProcessNode(int pid)
    {
        public int Pid { get; } = pid;
        public ProcessInfo? ProcessInfo { get; set; }
        public ProcessNode? Parent { get; set; }
        public List<ProcessNode> Children { get; } = new List<ProcessNode>();
    }

    public class ProcessInfoTree(ProcessInfo processInfo, IReadOnlyList<ProcessInfoTree> children)
    {
        public static IReadOnlyList<ProcessInfoTree> CreateSnapshot()
        {
            var processNodes = new Dictionary<int, ProcessNode>();

            ProcessInfo.EnumerateProcessInfos(processInfo =>
            {
                if (!processNodes.ContainsKey(processInfo.Id))
                {
                    processNodes[processInfo.Id] = new ProcessNode(processInfo.Id);
                }
                processNodes[processInfo.Id].ProcessInfo = processInfo;

                if (!processNodes.ContainsKey(processInfo.ParentPid))
                {
                    processNodes[processInfo.ParentPid] = new ProcessNode(processInfo.ParentPid);
                }
                processNodes[processInfo.Id].Parent = processNodes[processInfo.ParentPid];
                processNodes[processInfo.ParentPid].Children.Add(processNodes[processInfo.Id]);
            });


            ProcessInfoTree BuildProcessInfoTree(ProcessNode node)
            {
                if (node.ProcessInfo == null)
                {
                    node.ProcessInfo = new ProcessInfo(node.Pid, "<unknown>", node.Parent?.Pid ?? 0);
                }

                var children = new List<ProcessInfoTree>();
                foreach (var childNode in node.Children)
                {
                    children.Add(BuildProcessInfoTree(childNode));
                }
                return new ProcessInfoTree(node.ProcessInfo, new ReadOnlyCollection<ProcessInfoTree>(children));
            }

            var rootProcesses = new List<ProcessInfoTree>();
            foreach (var node in processNodes.Values)
            {
                if (node.Parent == null)
                {
                    rootProcesses.Add(BuildProcessInfoTree(node));
                }
            }

            return new ReadOnlyCollection<ProcessInfoTree>(rootProcesses);
        }

        public ProcessInfo ProcessInfo { get; } = processInfo;
        public IReadOnlyList<ProcessInfoTree> Children { get; } = children;

        public Process ToProcess() => Process.GetProcessById(ProcessInfo.Id);

        public ProcessTree ToProcessInfoTree()
        {
            return new ProcessTree(
            ToProcess(),
            Children.Select(c => c.ToProcessInfoTree()).ToList()
            );
        }

        public override string ToString()
        {
            return ToString(0);
        }

        private string ToString(int depth)
        {
            string indent = new(' ', depth * 2);
            var result = $"{indent}PID: {ProcessInfo.Id}, Name: {ProcessInfo.ExecName}, Children: {Children.Count}";

            foreach (var child in Children)
            {
                result += Environment.NewLine + child.ToString(depth + 1);
            }

            return result;
        }
    }

    public class ProcessTree(Process process, IReadOnlyList<ProcessTree> children)
    {
        /// <summary>
        /// Gets the process trees for all processes that match the specified executable path.
        /// All subtrees are disjoint and maximal.
        /// </summary>
        public static IReadOnlyList<ProcessTree> GetProcessTrees(Predicate<ProcessInfo> filter)
        {
            var tree = ProcessInfoTree.CreateSnapshot();
            var matchingProcesses = new List<ProcessTree>();

            void FindMatchingProcesses(ProcessInfoTree node)
            {
                if (filter(node.ProcessInfo))
                {
                    matchingProcesses.Add(node.ToProcessInfoTree());
                }
                foreach (var child in node.Children)
                {
                    FindMatchingProcesses(child);
                }
            }
            foreach (var root in tree)
            {
                FindMatchingProcesses(root);
            }
            return new ReadOnlyCollection<ProcessTree>(matchingProcesses);
        }

        public static ProcessTree CreateFrom(Process process)
        {
            var childrenMap = new Dictionary<int, List<int>>();
            ProcessInfo.EnumerateProcessInfos(processInfo =>
            {
                if (processInfo.ParentPid != 0)
                {
                    int parentPid = processInfo.ParentPid;
                    int pid = processInfo.Id;

                    if (!childrenMap.ContainsKey(parentPid))
                    {
                        childrenMap[parentPid] = [];
                    }
                    childrenMap[parentPid].Add(pid);
                }
            });

            ProcessTree BuildProcessTree(Process proc)
            {
                int pid = proc.Id;
                var children = new List<ProcessTree>();

                if (childrenMap.ContainsKey(pid))
                {
                    foreach (int childPid in childrenMap[pid])
                    {
                        var childProcess = Process.GetProcessById(childPid)!;
                        children.Add(BuildProcessTree(childProcess));
                    }
                }

                return new ProcessTree(proc, children);
            }

            return BuildProcessTree(process);
        }

        public Process Process { get; set; } = process;
        public IReadOnlyList<ProcessTree> Children { get; set; } = children;

        public void DebugPrint(int depth = 0)
        {
            string indent = new(' ', depth * 2);
            Console.WriteLine($"{indent}PID: {Process.Id}, Name: {Process.ProcessName}, Children: {Children.Count}");

            foreach (var child in Children)
            {
                child.DebugPrint(depth + 1);
            }
        }

        public IEnumerable<ProcessTree> GetAll()
        {
            var allProcesses = new List<ProcessTree> { this };
            foreach (var child in Children)
            {
                allProcesses.AddRange(child.GetAll());
            }
            return allProcesses;
        }
    }


    public class ProcessInfo(int pid, string execName, int parentPid = 0)
    {
        public static void EnumerateProcessInfos(Action<ProcessInfo> handleProcessInfo)
        {
            IntPtr snapshot = NativeMethods.CreateToolhelp32Snapshot(NativeMethods.TH32CS_SNAPPROCESS, 0);
            if (snapshot == NativeMethods.INVALID_HANDLE_VALUE)
            {
                throw new InvalidOperationException("Failed to create process snapshot.");
            }

            try
            {
                var processEntry = new PROCESSENTRY32
                {
                    dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32))
                };

                if (NativeMethods.Process32First(snapshot, ref processEntry))
                {
                    do
                    {
                        var processInfo = new ProcessInfo(
                            (int)processEntry.th32ProcessID,
                            processEntry.szExeFile,
                            (int)processEntry.th32ParentProcessID
                        );
                        handleProcessInfo(processInfo);
                    } while (NativeMethods.Process32Next(snapshot, ref processEntry));
                }
            }
            finally
            {
                NativeMethods.CloseHandle(snapshot);
            }
        }

        public int Id { get; } = pid;
        public string ExecName { get; } = execName;
        public int ParentPid { get; } = parentPid;

        public override string ToString()
        {
            return $"PID: {Id}, ExecName: {ExecName}, ParentPID: {ParentPid}";
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    static class NativeMethods
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

        [DllImport("kernel32.dll")]
        public static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll")]
        public static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CloseHandle(IntPtr hObject);

        public const uint TH32CS_SNAPPROCESS = 0x00000002;
        public static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);
    }
}
