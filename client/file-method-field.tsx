import { useId } from 'react'
import { useTranslate } from '@chatluna/ui-client/client'
import { Field, FieldContent, FieldDescription, FieldLabel, FieldSet, FieldTitle, RadioGroup, RadioGroupItem } from '@chatluna/ui-kit'
import { extensionProps, type SchemaRendererProps } from '@chatluna/ui-schema-form/client'

export function FileMethodField(props: SchemaRendererProps) {
  const id = useId()
  const t = useTranslate('jmcomic')
  const value = typeof props.value === 'string' ? props.value : props.schema.meta.default
  return (
    <div className="min-w-0 text-sm leading-5" data-jmcomic-file-method="">
      {extensionProps(props, (
        <FieldSet>
          <RadioGroup aria-label={String(props.schema.meta.label ?? props.path)} value={value} onValueChange={(next) => props.onChange(next)}>
            {props.schema.list?.map((option) => {
              const mode = String(option.value)
              const controlId = `${id}-${mode}`
              return (
                <FieldLabel key={mode} htmlFor={controlId}>
                  <Field orientation="horizontal">
                    <RadioGroupItem id={controlId} value={mode} aria-describedby={`${controlId}-description`} />
                    <FieldContent className="min-w-0">
                      <FieldTitle>{t(`${mode}.title`)}</FieldTitle>
                      <FieldDescription id={`${controlId}-description`}>{t(`${mode}.description`)}</FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
              )
            })}
          </RadioGroup>
          <FieldDescription>{t('tools.description')}</FieldDescription>
        </FieldSet>
      ), true)}
    </div>
  )
}
