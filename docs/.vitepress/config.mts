import { defineConfig } from "vitepress"

export default defineConfig({
  title: "Homenet2MQTT",
  description: "RS485 HomeNet to MQTT Bridge Documentation",

  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Configuration", link: "/config-schema/" },
      { text: "Manufacturer Guides", link: "/제조사별안내/bestin" }
    ],

    sidebar: {
      "/config-schema/": [
        {
          text: "Configuration",
          items: [
            { text: "Overview", link: "/config-schema/" },
            { text: "Schemas", link: "/config-schema/schemas" },
            { text: "Packet Defaults", link: "/config-schema/packet-defaults" },
            { text: "Common Options", link: "/config-schema/common-entity-options" }
          ]
        },
        {
          text: "Entity Types",
          items: [
            { text: "Binary Sensor", link: "/config-schema/binary-sensor" },
            { text: "Button", link: "/config-schema/button" },
            { text: "Climate", link: "/config-schema/climate" },
            { text: "Fan", link: "/config-schema/fan" },
            { text: "Light", link: "/config-schema/light" },
            { text: "Lock", link: "/config-schema/lock" },
            { text: "Number", link: "/config-schema/number" },
            { text: "Select", link: "/config-schema/select" },
            { text: "Sensor", link: "/config-schema/sensor" },
            { text: "Switch", link: "/config-schema/switch" },
            { text: "Text", link: "/config-schema/text" },
            { text: "Text Sensor", link: "/config-schema/text-sensor" },
            { text: "Valve", link: "/config-schema/valve" }
          ]
        }
      ],
      "/제조사별안내/": [
        {
          text: "Manufacturer Guides",
          items: [
            { text: "Bestin", link: "/제조사별안내/bestin" },
            { text: "Commax", link: "/제조사별안내/commax" },
            { text: "CVnet", link: "/제조사별안내/cvnet" },
            { text: "Ezville", link: "/제조사별안내/ezville" },
            { text: "Hyundai", link: "/제조사별안내/hyundai" },
            { text: "Kocom", link: "/제조사별안내/kocom" },
            { text: "Samsung SDS", link: "/제조사별안내/samsung_sds" }
          ]
        }
      ],
      "/": [
        {
          text: "Guide",
          items: [
            { text: "Introduction", link: "/" },
            { text: "Automation", link: "/AUTOMATION" },
            { text: "CEL Guide", link: "/CEL_GUIDE" },
            { text: "Entity Examples", link: "/ENTITY_EXAMPLES" },
            { text: "Gallery", link: "/GALLERY" },
            { text: "Scripts", link: "/SCRIPTS" },
            { text: "Breaking Changes", link: "/BREAKING_CHANGES" }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/wooooooooooook/homenet2mqtt" }
    ]
  }
})
