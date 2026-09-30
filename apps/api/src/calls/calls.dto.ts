import { IsIn, IsString } from 'class-validator';

export class StartCallDto {
  @IsString()
  chatId!: string;

  @IsIn(['VOICE', 'VIDEO'])
  type!: 'VOICE' | 'VIDEO';
}
