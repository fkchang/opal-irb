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

      it 'recognizes a global variable' do
        expect(' $ab.' =~ OpalIrb::CompletionEngine::VARIABLE_DOT_COMPLETE).to_not be_falsey
      end

      it 'recognizes a class' do
        expect(' Ab.' =~ OpalIrb::CompletionEngine::VARIABLE_DOT_COMPLETE).to_not be_falsey
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
      it 'recognizes global' do
        expect('$global.ab' =~ OpalIrb::CompletionEngine::METHOD_COMPLETE).to_not be_falsey
      end
      it 'recognizes class' do
        expect('Klass.ab' =~ OpalIrb::CompletionEngine::METHOD_COMPLETE).to_not be_falsey
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

  context '#complete' do
    context 'VARIABLE_DOT_COMPLETE' do
      it 'processes global dot' do
        results = OpalIrb::CompletionEngine.complete('$window.', OpalIrb.new)
        results.old_prompt.should == '$window.'
        results.new_prompt_text.should == '$window.'
        results.matches.size.should > 5
      end
      it 'processes variable dot' do
        irb = OpalIrb.new
        js = irb.parse('foo_var_bar = "2"')
        `eval(#{js})`
        results = OpalIrb::CompletionEngine.complete('foo_var_bar.', irb)
        results.old_prompt.should == 'foo_var_bar.'
        results.new_prompt_text.should == 'foo_var_bar.'
        results.matches.size.should > 5
        results.matches.include?('reverse').should == true
      end
      it 'processes constant dot' do
        results = OpalIrb::CompletionEngine.complete('STDIN.', OpalIrb.new)
        results.old_prompt.should == 'STDIN.'
        results.new_prompt_text.should == 'STDIN.'
        results.matches.size.should > 5
        results.matches.include?('write').should == true
      end
    end
  end

end
