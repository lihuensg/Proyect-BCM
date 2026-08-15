import { Controller, Get } from "@nestjs/common";

type HealthResponse = Readonly<{
  status: "ok";
}>;

@Controller("health")
export class HealthController {
  @Get("live")
  live(): HealthResponse {
    return { status: "ok" };
  }

  @Get("ready")
  ready(): HealthResponse {
    return { status: "ok" };
  }
}
