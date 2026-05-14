import { HomeScreen } from "./HomeScreen";
import { useApp } from "./appStore";
import { AssetsEditor } from "./tools/assets/AssetsEditor";
import { ConverterScreen } from "./tools/converter/ConverterScreen";
import { MapScreen } from "./tools/map/MapScreen";

export default function App() {
  const tool = useApp((s) => s.tool);
  switch (tool) {
    case "assets":
      return <AssetsEditor />;
    case "converter":
      return <ConverterScreen />;
    case "map":
      return <MapScreen />;
    case "home":
    default:
      return <HomeScreen />;
  }
}
