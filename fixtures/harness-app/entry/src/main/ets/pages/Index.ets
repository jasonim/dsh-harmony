@Entry
@Component
struct Index {
  @State clickCount: number = 0;
  @State inputValue: string = '';

  private readonly rows: string[] = [
    'Row 01', 'Row 02', 'Row 03', 'Row 04', 'Row 05',
    'Row 06', 'Row 07', 'Row 08', 'Row 09', 'Row 10',
    'Row 11', 'Row 12', 'Row 13', 'Row 14', 'Row 15',
    'Row 16', 'Row 17', 'Row 18', 'Row 19', 'Row 20'
  ];

  build() {
    Column({ space: 12 }) {
      Text('DSH Harmony Input Harness')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)

      Button('Tap target')
        .id('dsh_click_target')
        .accessibilityText('DSH Click Target')
        .onClick(() => {
          this.clickCount += 1;
        })

      Text(`Click count: ${this.clickCount}`)
        .id('dsh_click_count')

      TextInput({ placeholder: 'Enter deterministic text', text: this.inputValue })
        .id('dsh_text_input')
        .accessibilityText('DSH Text Input')
        .onChange((value: string) => {
          this.inputValue = value;
        })

      Text(`Input: ${this.inputValue}`)
        .id('dsh_input_value')

      List({ space: 6 }) {
        ForEach(this.rows, (row: string) => {
          ListItem() {
            Text(row)
              .fontSize(20)
              .width('100%')
              .padding(16)
              .backgroundColor('#EAF1FB')
          }
        }, (row: string) => row)
      }
      .id('dsh_swipe_list')
      .accessibilityText('DSH Swipe List')
      .layoutWeight(1)
      .width('100%')
    }
    .padding(24)
    .width('100%')
    .height('100%')
  }
}

