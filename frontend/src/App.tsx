import { HomeScreen } from "./HomeScreen";
import { UpdateBanner } from "./UpdateBanner";
import { useApp } from "./appStore";
import { AssetsEditor } from "./tools/assets/AssetsEditor";
import { ConverterScreen } from "./tools/converter/ConverterScreen";
import { MapConverterScreen } from "./tools/mapconv/MapConverterScreen";
import { MapScreen } from "./tools/map/MapScreen";

function CurrentTool() {
  const tool = useApp((s) => s.tool);
  switch (tool) {
    case "assets":
      return <AssetsEditor />;
    case "converter":
      return <ConverterScreen />;
    case "mapConverter":
      return <MapConverterScreen />;
    case "map":
      return <MapScreen />;
    case "home":
    default:
      return <HomeScreen />;
  }
}

export default function App() {
  return (
    <>
      <CurrentTool />
      {/* Floats over whatever tool is active; self-hides when up to date. */}
      <UpdateBanner />
    </>
  );
}
