class Timeout
  def initialize(_time=0, &block)
    @timeout = `setTimeout(#{block}, time)`
  end

  def clear
    `clearTimeout(#{@timeout})`
  end
end
