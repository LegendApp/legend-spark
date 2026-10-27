import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { createBarcodeScanner } from "react-native-nitro-zxing";
import { loadImage } from "react-native-nitro-image";
import { toByteArray } from "base64-js";
import { getDirectory, writeBytes } from "@legendapp/spark/files";

// Test IDs: media-nitro-zxing-<value> shows the decoded QR value (the expected one is spark-kitchen-sink),
// or media-nitro-zxing-failed.
const ID = "media-nitro-zxing";
// A QR code for "spark-kitchen-sink" generated with Core Image's CIQRCodeGenerator.
const QR = "iVBORw0KGgoAAAANSUhEUgAAAGwAAABsCAYAAACPZlfNAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAbKADAAQAAAABAAAAbAAAAADaE/gkAAAEYklEQVR4Ae3cy25kRwwD0DjI///yjJHlacCEULe6ZYDeKdSDl0xJ8GCSrz/fP//059co8O+vYVqi/ytQw37Zvwg17JcZ9p98v76+/EdX49MTOuWb5tnPfPGr4nw3d35f2G3FH+5fwx4W9Ha7GnZb4Yf7v9ww+7tDxafx9AaYLx9j+Vif8NTP+mm+9caJb1+Yii2Pa9hyg6RXw1RkeRxvmPzTjjV/uuNTf3H738b9PmPnixvLX9y4L0xFlsc1bLlB0qthKrI8Ht+wd3/PdMcnfqlfwlP/23hf2G2FH+5fwx4W9Ha7GnZb4Yf7r79h/l7jjRFXH3HrT/Otvx33hd1W+OH+NexhQW+3q2G3FX64//iGpRvwML+Xdt4kE+RnvrH1p7HzT/tZ3xemIsvjGrbcIOnVMBVZHscbdnvnJ328CfK5jSd+8kn5p3hf2KmCb66vYW8W/HRcDTtV8M31LzfMm/BmPuNx6YaI+30Jl5D14rfjvrDbCj/cv4Y9LOjtdjXstsIP93+5YWmni5/y8SYYT+dZLz/7pfxULz6Np/P7wqYKfzi/hn3YgOn4GjZV7MP5X9879Mf/T4c7/5Sv41J/851/Wp/6TeebLz9x56e4LywptAyvYcsMSXRqWFJoGR5v2Clfd/hpv1Q/vRGJn/3MF0/8xO0nbv++MBVaHtew5QZJr4apyPI4/lmi/N2p4tOdbP1p7Hz5Jtz5KT/h9jNO/MzvC1OR5XENW26Q9GqYiiyPX34PSzs54X6v+eLGaaeLWz+Np/ym/eXrvCneFzZ14MP5NezDBkzH17CpYh/Of/k9TD7uXHFj893RKd9681M8rZef9eLOT/mnuPP6wlRkeVzDlhskvRqmIsvjeMPc4e7k6fdZP+2f6k/7Tb9nmi9/68X9nr4wFVse17DlBkmvhqnI8jjeMPm7U9255hun+oTbzzjxebp/6iee+Kb8vjAVXB7XsOUGSa+GqcjyeHzDvBHuXHG/X9x6809j+6f54sbyOcWn/PrCdGB5XMOWGyS9GqYiy+OXv9Pxab7pJrjzT/k+PS/1S3zT9/WFJQWX4TVsmSGJTg1LCi3DX34PO93B0+9zZxsnPgm3n/zEUz9x62/37wtT4eVxDVtukPRqmIosj19umHzTjjY/xd4A88Wn81O+/Z2f4tTfeudN6+3XF6Yiy+Mattwg6dUwFVkexxsmf3eyuPHpzp7Oc76xfFL/hNs/xfZLfMT7wpLCy/AatsyQRKeGJYWW4eMb9m7+7vA03xuR8k9x+Tk/4eYnPn1hSaFleA1bZkiiU8OSQsvw9TfMHe9NUE9x66f59rPe/ik/4fZzXl+YiiyPa9hyg6RXw1RkeTy+YWkHn37vaf90A+yf8hPu95rvPPOncV/YVLEP59ewDxswHV/Dpop9OD/eMHfybb7O8wYkXH6n9c6b9k/19ktxX1hSaBlew5YZkujUsKTQMnzdfx+2TJ91dPrC1lnyM6Ea9rM+69Aats6Snwn9Bflwihg/dJqNAAAAAElFTkSuQmCC";

async function scan() {
  const file = `${await getDirectory("data")}/zxing-demo.png`;
  await writeBytes(file, toByteArray(QR));
  const image = await loadImage({ filePath: file });
  try {
    const scanner = createBarcodeScanner({ barcodeFormats: ["qr-code"] });
    try {
      const [barcode] = await scanner.scanCodesInImageAsync(image);
      return barcode?.rawValue;
    } finally {
      scanner.dispose();
    }
  } finally {
    image.dispose();
  }
}

/** react-native-nitro-zxing through its own API; Spark adds the macOS build. */
export function NitroZxingDemo() {
  const [result, setResult] = useState<{ value?: string; error?: string }>();
  useEffect(() => { scan().then(value => setResult({ value }), error => setResult({ error: String(error) })); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Scans a QR code PNG from the app's data folder with ZXing (no camera).</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result && (result.value ? `${ID}-${result.value}` : `${ID}-failed`)}>{result ? result.value ?? `failed: ${result.error ?? "no QR code found"}` : "scanning"}</Text>
  </ScrollView>;
}
