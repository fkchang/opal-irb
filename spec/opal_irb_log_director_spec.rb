require 'spec_helper'
require 'opal_irb_log_redirector'
describe OpalIrbLogRedirector do
  it "redirect to added log clients" do
    test_1 = "not changed 1"
    test_2 = "not changed 2"
    test_lambda1 = lambda {|stuff| test_1 = stuff}
    test_lambda2 = lambda {|stuff| test_2 = "#{stuff} 2"}

    OpalIrbLogRedirector.add_to_redirect(test_lambda1)
    OpalIrbLogRedirector.add_to_redirect(test_lambda2)

    OpalIrbLogRedirector.puts "changed"

    test_1.should == "changed"
    test_2.should == "changed 2"

  end
end
