Document.ready? do
  # alert :yo
  $jqconsole = Element.find('#console').jqconsole('Opal\n', '>>> ');
  $jqconsole.RegisterShortcut('Z', lambda { $jqconsole.AbortPrompt(); handler})
  $jqconsole.RegisterShortcut('A', lambda{ $jqconsole.MoveToStart(); handler})
  $jqconsole.RegisterShortcut('E', lambda{ $jqconsole.MoveToEnd(); handler})
  $jqconsole.RegisterShortcut('B', lambda{ $jqconsole._MoveLeft(); handler})
  $jqconsole.RegisterShortcut('F', lambda{ $jqconsole._MoveRight(); handler})
  $jqconsole.RegisterShortcut('N', lambda{ $jqconsole._HistoryNext(); handler})
  $jqconsole.RegisterShortcut('P', lambda{ $jqconsole._HistoryPrevious(); handler})
  def handler(cmd)
    if cmd
      begin
        $jqconsole.Write("==> " + `window.eval(cmd)` + "\n")
      rescue Error => e
        $jqconsole.Write('Error: ' + e.message + "\n")
      end
    end
    $jqconsole.Prompt(true, lambda {|c| handler(c) })

  end
  handler()

  alert :dude1
end
