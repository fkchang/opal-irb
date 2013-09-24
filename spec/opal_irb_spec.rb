require 'spec_helper'
require 'opal_irb'

describe OpalIrb do
  let(:subject) {OpalIrb.new}
  it "should parse with irb parsing" do
    cmd = "'cmd'";
    # want to do this
    # subject.parser.should_receive(:parse).with(cmd, :irb => true)
    # subject.parse cmd
    subject.parse(cmd).should =~ /irb_vars/
  end
end
