'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CUSTOM_CATEGORY_MAX_LENGTH,
  formatCategory,
  isBuiltInCategory,
} from '@/lib/categories'

const CUSTOM_SENTINEL = '__custom__'

interface CategoryPickerProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string; color?: string }[]
  placeholder?: string
}

/**
 * Category dropdown with a "Custom..." entry. Choosing it reveals a text field
 * so people can type their own category (e.g. "Piano lessons").
 */
export function CategoryPicker({ value, onChange, options, placeholder = 'Select category' }: CategoryPickerProps) {
  const valueIsCustom = !!value && !isBuiltInCategory(value, options)
  const [customMode, setCustomMode] = useState(valueIsCustom)
  const showInput = customMode || valueIsCustom

  const selectValue = showInput
    ? CUSTOM_SENTINEL
    : options.find((o) => o.value.toLowerCase() === (value || '').toLowerCase())?.value || ''

  return (
    <div className="space-y-2">
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (v === CUSTOM_SENTINEL) {
            setCustomMode(true)
            if (!valueIsCustom) onChange('')
          } else {
            setCustomMode(false)
            onChange(v)
          }
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={placeholder}>
            {showInput ? (value ? formatCategory(value) : 'Custom...') : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <div className="flex items-center gap-2">
                {opt.color && <div className={`w-3 h-3 rounded-full ${opt.color}`} />}
                {opt.label}
              </div>
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_SENTINEL}>Custom...</SelectItem>
        </SelectContent>
      </Select>
      {showInput && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, CUSTOM_CATEGORY_MAX_LENGTH))}
          placeholder="Type your own category, e.g. Piano lessons"
          maxLength={CUSTOM_CATEGORY_MAX_LENGTH}
          autoFocus={!valueIsCustom}
        />
      )}
    </div>
  )
}
