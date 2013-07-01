require 'object_extensions'
class TestClass
  def initialize
    @a = "value_for_a"
    @b = "value_for_b"
  end
end

describe Object do

  describe "#irb_instance_variables" do

    it "should show vars and not _id, constructor, and toString" do
      f = TestClass.new
      f.irb_instance_variables.should == ["a", "b"]
    end

  end

  describe "#irb_instance_var_values" do

    it "should show vars and not _id, constructor, and toString" do
      f = TestClass.new
      f.irb_instance_var_values.should == [["a", "value_for_a"],
                                           ["b", "value_for_b"]]
    end

  end

end
