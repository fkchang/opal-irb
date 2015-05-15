describe OpalIrb::CompletionEngine do
  context 'regexps' do
    context 'recognizes VARIABLE_DOT_COMPLETE' do

      it 'recognizes 1 letter dot' do
        expect('a.' =~ OpalIrb::CompletionEngine::VARIABLE_DOT_COMPLETE).to_not be_falsey
      end

      it 'recognizes spc 1 letter dot' do
        expect(' a.' =~ OpalIrb::CompletionEngine::VARIABLE_DOT_COMPLETE).to_not be_falsey
      end

      it 'recognizes 2 letter dot' do
        expect('ab.' =~ OpalIrb::CompletionEngine::VARIABLE_DOT_COMPLETE).to_not be_falsey
      end

      it 'recognizes spc 2 letter dot' do
        expect(' ab.' =~ OpalIrb::CompletionEngine::VARIABLE_DOT_COMPLETE).to_not be_falsey
      end

    end

    context 'recognizes METHOD_COMPLETE' do

      it 'recognizes 1 letter dot 1 letter' do
        expect('a.a' =~ OpalIrb::CompletionEngine::METHOD_COMPLETE).to_not be_falsey
      end
      it 'recognizes 2 letter dot 1 letter' do
        expect('ab.a' =~ OpalIrb::CompletionEngine::METHOD_COMPLETE).to_not be_falsey
      end

      it 'recognizes spc 1 letter dot 2 letter' do
        expect(' a.ab' =~ OpalIrb::CompletionEngine::METHOD_COMPLETE).to_not be_falsey
      end
      it 'recognizes spc 2 letter dot 2 letter' do
        expect(' ab.ab' =~ OpalIrb::CompletionEngine::METHOD_COMPLETE).to_not be_falsey
      end
    end

    context 'recognizes CONSTANT' do
      it 'recognizes 1 capital letter' do
        expect('A' =~ OpalIrb::CompletionEngine::CONSTANT).to_not be_falsey
      end
      it 'recognizes 2 capital letters' do
        expect('AB' =~ OpalIrb::CompletionEngine::CONSTANT).to_not be_falsey
      end

      it 'recognizes spc 1 capital letter' do
        expect(' A' =~ OpalIrb::CompletionEngine::CONSTANT).to_not be_falsey
      end
      it 'recognizes spc 2 capital letter' do
        expect(' AB' =~ OpalIrb::CompletionEngine::CONSTANT).to_not be_falsey
      end
    end

    context 'recognizes METHOD_OR_VARIABLE' do
      it 'recognizes 1 lowercase letter' do
        expect('a' =~ OpalIrb::CompletionEngine::METHOD_OR_VARIABLE).to_not be_falsey
      end
      it 'recognizes 2 lowercase letters' do
        expect('ab' =~ OpalIrb::CompletionEngine::METHOD_OR_VARIABLE).to_not be_falsey
      end

      it 'recognizes spc 1 lowercase letter' do
        expect(' a' =~ OpalIrb::CompletionEngine::METHOD_OR_VARIABLE).to_not be_falsey
      end
      it 'recognizes spc 2 lowercase letter' do
        expect(' ab' =~ OpalIrb::CompletionEngine::METHOD_OR_VARIABLE).to_not be_falsey
      end
    end

  end
end
