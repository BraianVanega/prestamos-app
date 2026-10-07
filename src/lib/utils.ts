import { createCn } from "cn/config";

/**
 * `cn` con los tokens propios de DESIGN.md registrados. Sin esto, `text-label-caps`
 * se toma como un color y se pierde al combinarlo con `text-on-surface-variant`.
 * Los componentes de shadcn deben importar `cn` de acá, no del paquete "cn".
 */
export const cn = createCn({
  extend: {
    theme: {
      spacing: [
        "gutter", "gutter-compact", "margin", "margin-panel",
        "space-2xs", "space-xs", "space-sm", "space-md", "space-lg", "space-xl",
      ],
    },
    classGroups: {
      "font-size": [
        {
          text: [
            "headline-xl", "headline-lg", "headline-sm",
            "body-lg", "body-md", "body-sm",
            "data-currency-primary", "data-currency-secondary", "data-cell",
            "label-caps", "badge-label",
          ],
        },
      ],
    },
  },
});
