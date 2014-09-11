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

  it "should return classes" do
    opal_classes = subject.opal_classes
    expect(opal_classes.size).to be > 0
    expect(opal_classes.include?(OpalIrb)).to be true
  end
end
