class Array
  def in_groups_of(number, fill_with=nil)
    if number.to_i <= 0
      fail ArgumentError,
            "Group size must be a positive integer, was #{number.inspect}"
    end

    if fill_with == false
      collection = self
    else
      # size % number gives how many extra we have;
      # subtracting from number gives how many to add;
      # modulo number ensures we don't add group of just fill.
      padding = (number - size % number) % number
      collection = dup.concat(Array.new(padding, fill_with))
    end

    if block_given?
      collection.each_slice(number) {|slice| yield(slice) }
    else
      collection.each_slice(number).to_a
    end
  end
end

class OpalIrb
  # format completion in columns, like MRI irb
  class CompletionFormatter
    def self.format(choices)
      new.format(choices)
    end

    def format(choices, width=80)
      max_length = choices.inject(0) {|length, element| element.size > length ? element.size : length }
      num_cols = (width / (max_length + 1)).floor # coz this is JS

      num_cols -= 1 if max_length * num_cols == width

      column_width = max_length + ((width - (max_length * num_cols)) / num_cols).floor

      groups = choices.sort.in_groups_of(num_cols, false)
      groups.map {|grouping| grouping.map {|choice| sprintf("%-#{column_width}s", choice) }.join }.join("\n") + "\n"
    end
  end
end
