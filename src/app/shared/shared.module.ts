import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { TranslatePipe } from './pipes/translate.pipe';

@NgModule({
  imports: [CommonModule, TranslatePipe],
  exports: [TranslatePipe]
})
export class SharedModule {}
