import accessYamlText from "../../config/construction_access.yaml?raw";
import floorsYamlText from "../../config/construction_floors.yaml?raw";
import outdoorsYamlText from "../../config/construction_outdoors.yaml?raw";
import roofsYamlText from "../../config/construction_roofs.yaml?raw";
import structureYamlText from "../../config/construction_structure.yaml?raw";
import wallsYamlText from "../../config/construction_walls.yaml?raw";

export const defaultConstructionPieceCatalogTexts = [
  floorsYamlText,
  wallsYamlText,
  structureYamlText,
  accessYamlText,
  roofsYamlText,
  outdoorsYamlText,
] as const;
