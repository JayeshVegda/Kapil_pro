import * as React from "react"
import { cn } from "cn"
import { inputClass } from './form-control-classes'

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        inputClass,
        className
      )}
      {...props}
    />
  )
}

export { Input }
