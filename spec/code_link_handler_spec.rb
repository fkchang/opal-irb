require 'opal_irb_jqconsole'
describe OpalIrbJqconsole::CodeLinkHandler do


  describe "#create_link_for_code" do
    let(:subject) {OpalIrbJqconsole::CodeLinkHandler.new}
    it "should create encoded link for code" do
      subject.create_link_for_code("this = 1").should == "http://localhost:9999/#code:this%20%3D%201"
    end

    it "should not return link for nothing"do
      subject.create_link_for_code(nil).should == nil
    end
  end

  describe "#grab_link_code" do

    it "should extract decoded code" do
      subject = OpalIrbJqconsole::CodeLinkHandler.new(`{ hash: "#code:foo%3D1"}`)
      subject.grab_link_code.should == "foo=1"
    end

    it "should return nil if no code in hash" do
      subject = OpalIrbJqconsole::CodeLinkHandler.new(`{ hash: ""}`)
      subject.grab_link_code.should == nil
    end
  end

end
