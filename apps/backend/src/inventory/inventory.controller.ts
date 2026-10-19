import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser, IdParam, Roles } from '../common/decorators/index.js';
import type { Paginated } from '../common/pagination/index.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  IdempotencyKey,
  IDEMPOTENCY_REPLAYED_HEADER,
} from '../idempotency/idempotency-key.decorator.js';
import { CreateInventoryItemDto } from './dto/create-item.dto.js';
import { CreateStockMovementDto } from './dto/create-movement.dto.js';
import { ListInventoryItemsQueryDto } from './dto/list-items-query.dto.js';
import { ListStockMovementsQueryDto } from './dto/list-movements-query.dto.js';
import { UpdateInventoryItemDto } from './dto/update-item.dto.js';
import { InventoryItemsService } from './inventory-items.service.js';
import type {
  InventoryItemResponse,
  StockMovementResponse,
} from './inventory.presenter.js';
import { StockMovementsService } from './stock-movements.service.js';

@ApiTags('inventory')
@ApiBearerAuth()
@Roles(UserRole.FARMER)
@Controller('inventory/items')
export class InventoryController {
  constructor(
    private readonly items: InventoryItemsService,
    private readonly movements: StockMovementsService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInventoryItemDto,
  ): Promise<InventoryItemResponse> {
    return this.items.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListInventoryItemsQueryDto,
  ): Promise<Paginated<InventoryItemResponse>> {
    return this.items.list(user.id, query);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<InventoryItemResponse> {
    return this.items.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @Body() dto: UpdateInventoryItemDto,
  ): Promise<InventoryItemResponse> {
    return this.items.update(user.id, id, dto);
  }

  @Post(':id/open')
  @HttpCode(200)
  open(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<InventoryItemResponse> {
    return this.items.open(user.id, id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<InventoryItemResponse> {
    return this.items.archive(user.id, id);
  }

  @Post(':id/movements')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async createMovement(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @IdempotencyKey() key: string,
    @Body() dto: CreateStockMovementDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StockMovementResponse> {
    const result = await this.movements.create(user.id, id, key, dto);
    res.status(result.status);
    if (result.replayed) res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    return result.body;
  }

  @Get(':id/movements')
  listMovements(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @Query() query: ListStockMovementsQueryDto,
  ): Promise<Paginated<StockMovementResponse>> {
    return this.movements.list(user.id, id, query);
  }
}
