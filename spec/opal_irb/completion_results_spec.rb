describe OpalIrb::CompletionEngine::CompletionResults do
  describe "common_prefix" do
    subject {OpalIrb::CompletionEngine::CompletionResults.new("orig_text", 1, [])}
    it"finds for 2" do
      expect(subject.common_prefix_if_exists('a.b', 2, ['bellor', 'bella'])).to eq 'a.bell'
    end
    it"finds for spc 2" do
      expect(subject.common_prefix_if_exists(' a.b', 3, ['bellor', 'bella'])).to eq ' a.bell'
    end

    it'finds for 3' do
      expect(subject.common_prefix_if_exists('a.f', 2, ['fellor', 'fella', 'fells_point'])).to eq 'a.fell'
    end

    it'finds for 3' do
      expect(subject.common_prefix_if_exists(' a.f', 3, ['fellor', 'fella', 'fells_point'])).to eq ' a.fell'
    end

    it'doesn\'t change when no common prefix' do
      expect(subject.common_prefix_if_exists(' a.f', 3, ['fellow', 'freeze'])).to eq ' a.f'
    end

    it'match_index == 0, no common matches' do
      expect(subject.common_prefix_if_exists('a', 0, ['alert', 'able'])).to eq 'a'
    end

  end
end
